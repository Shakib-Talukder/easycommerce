import { createId } from "@paralleldrive/cuid2";
import { Prisma, withStore, type TenantTx } from "@repo/db";
import { getStorageProvider, type StorageProvider } from "../storage";
import {
  assignValueIds,
  optionKey,
  planVariants,
  sortAxes,
  type ExistingVariant,
  type OptionAxis,
  type OptionValues,
  type VariantFields,
} from "./options";
import { MAX_FEATURED, type BulkAction, type ProductInput } from "./schemas";
import { baseSlug, nextFreeSlug } from "./slug";

/*
 * Products and their variants. Every mutation runs in one withStore() transaction,
 * so RLS limits it to the store; ids from another store simply aren't found.
 */

export type ProductError =
  | "NOT_FOUND"
  | "CATEGORY_NOT_FOUND"
  | "FEATURED_LIMIT"
  | "SKU_TAKEN"
  | "SALE_PRICE_TOO_HIGH"
  | "STALE_UPDATE";

export type Fail<E extends ProductError = ProductError> = { ok: false; error: E; detail?: string };
export type SaveProductResult = { ok: true; id: string; slug: string } | Fail;

class Rollback extends Error {
  constructor(readonly failure: Fail) {
    super(failure.error);
  }
}
const fail = (error: ProductError, detail?: string): never => {
  throw new Rollback({ ok: false, error, ...(detail ? { detail } : {}) });
};

/** Runs `fn` in one store transaction; a fail() inside rolls everything back and returns the failure. */
async function transaction<T>(storeId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T | Fail> {
  try {
    return await withStore(storeId, fn, { timeout: 20_000 });
  } catch (error) {
    if (error instanceof Rollback) return error.failure;
    // Unique SKU index (variants_store_id_sku_key) lost a race.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      String(error.meta?.target ?? error.message).includes("sku")
    ) {
      return { ok: false, error: "SKU_TAKEN" };
    }
    throw error;
  }
}

export async function uniqueProductSlug(tx: TenantTx, storeId: string, base: string, excludeId?: string) {
  const rows = await tx.product.findMany({
    where: {
      storeId,
      deletedAt: null,
      slug: { startsWith: base },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { slug: true },
  });
  return nextFreeSlug(
    base,
    rows.map((r) => r.slug),
  );
}

async function assertCategory(tx: TenantTx, storeId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const found = await tx.category.findFirst({
    where: { id: categoryId, storeId, deletedAt: null },
    select: { id: true },
  });
  if (!found) fail("CATEGORY_NOT_FOUND");
}

async function featuredCount(tx: TenantTx, storeId: string, excludeIds: string[] = []) {
  return tx.product.count({
    where: { storeId, isFeatured: true, deletedAt: null, id: { notIn: excludeIds } },
  });
}

async function nextFeaturedOrder(tx: TenantTx, storeId: string) {
  const last = await tx.product.aggregate({
    where: { storeId, isFeatured: true },
    _max: { featuredOrder: true },
  });
  return (last._max.featuredOrder ?? -1) + 1;
}

/** SKUs used by the store's live variants, optionally excluding one product's. */
async function takenSkus(tx: TenantTx, storeId: string, excludeProductId?: string) {
  const rows = await tx.variant.findMany({
    where: {
      storeId,
      deletedAt: null,
      ...(excludeProductId ? { productId: { not: excludeProductId } } : {}),
    },
    select: { sku: true },
  });
  return rows.map((r) => r.sku);
}

/**
 * Applies the planned variant rows: soft deletes first (frees option keys and
 * SKUs), then updates, then creates. Checks sale < price and SKU uniqueness
 * with clear errors before the database would.
 */
async function applyVariants(
  tx: TenantTx,
  storeId: string,
  productId: string,
  product: { slug: string; options: OptionAxis[] },
  input: Pick<ProductInput, "variants" | "defaultPrice">,
  existing: (ExistingVariant & { imageId: string | null })[],
) {
  const others = await takenSkus(tx, storeId, productId);
  const plan = planVariants({
    axes: product.options,
    existing,
    submitted: input.variants.map((row) => ({
      optionValues: row.optionValues as OptionValues,
      ...(row.sku !== undefined ? { sku: row.sku } : {}),
      ...(row.price !== undefined ? { price: row.price } : {}),
      ...(row.salePrice !== undefined ? { salePrice: row.salePrice } : {}),
      ...(row.stock !== undefined ? { stock: row.stock } : {}),
      ...(row.weightGrams !== undefined ? { weightGrams: row.weightGrams } : {}),
      ...(row.isActive !== undefined ? { isActive: row.isActive } : {}),
    })),
    productSlug: product.slug,
    defaultPrice: input.defaultPrice,
    takenSkus: others,
  });

  // Final SKUs: unique within the product and not used by another product.
  const byId = new Map(existing.map((v) => [v.id, v]));
  const finalSkus = [
    ...plan.update.map((u) => u.fields.sku ?? byId.get(u.id)!.sku),
    ...plan.create.map((c) => c.fields.sku),
  ].map((s) => s.toUpperCase());
  const otherSet = new Set(others.map((s) => s.toUpperCase()));
  const dup = finalSkus.find((s, i) => finalSkus.indexOf(s) !== i || otherSet.has(s));
  if (dup) fail("SKU_TAKEN", dup);

  const salePriceOk = (price: number, sale: number | null) => sale === null || sale < price;
  if (plan.softDelete.length) {
    await tx.variant.updateMany({ where: { id: { in: plan.softDelete } }, data: { deletedAt: new Date() } });
  }
  for (const u of plan.update) {
    const current = byId.get(u.id)!;
    const price = u.fields.price ?? current.price;
    const sale = u.fields.salePrice === undefined ? current.salePrice : u.fields.salePrice;
    if (!salePriceOk(price, sale)) fail("SALE_PRICE_TOO_HIGH", optionKey(u.optionValues));
    await tx.variant.update({ where: { id: u.id }, data: u.fields });
  }
  for (const c of plan.create) {
    if (!salePriceOk(c.fields.price, c.fields.salePrice))
      fail("SALE_PRICE_TOO_HIGH", optionKey(c.optionValues));
    await tx.variant.create({
      data: {
        storeId,
        productId,
        optionValues: c.optionValues,
        optionKey: optionKey(c.optionValues),
        ...c.fields,
      },
    });
  }
  return plan;
}

const variantSelect = {
  id: true,
  optionKey: true,
  sku: true,
  price: true,
  salePrice: true,
  stock: true,
  imageId: true,
} as const;

/** Creates a product with its variants (one default variant for a simple product). */
export async function createProduct(storeId: string, input: ProductInput): Promise<SaveProductResult> {
  return transaction(storeId, async (tx): Promise<SaveProductResult> => {
    await assertCategory(tx, storeId, input.categoryId);
    if (input.isFeatured && (await featuredCount(tx, storeId)) >= MAX_FEATURED) fail("FEATURED_LIMIT");
    const slug = await uniqueProductSlug(tx, storeId, input.slug ?? baseSlug(input.titleEn, input.titleBn));
    const options = assignValueIds(input.options);
    const product = await tx.product.create({
      data: {
        storeId,
        slug,
        titleBn: input.titleBn,
        titleEn: input.titleEn,
        descriptionBn: input.descriptionBn ?? null,
        descriptionEn: input.descriptionEn ?? null,
        categoryId: input.categoryId ?? null,
        status: input.status,
        isFeatured: input.isFeatured,
        featuredOrder: input.isFeatured ? await nextFeaturedOrder(tx, storeId) : null,
        options,
      },
      select: { id: true, slug: true },
    });
    await applyVariants(tx, storeId, product.id, { slug, options }, input, []);
    return { ok: true, ...product };
  });
}

/**
 * Updates a product and reconciles its variants with the (possibly edited) axes:
 * matching variants keep price/stock/SKU, new combinations are created, removed
 * ones are soft-deleted.
 */
export async function updateProduct(
  storeId: string,
  id: string,
  input: ProductInput,
): Promise<SaveProductResult> {
  return transaction(storeId, async (tx): Promise<SaveProductResult> => {
    const current = await tx.product.findFirst({ where: { id, storeId, deletedAt: null } });
    if (!current) fail("NOT_FOUND");
    await assertCategory(tx, storeId, input.categoryId);
    const becomesFeatured = input.isFeatured && !current!.isFeatured;
    if (becomesFeatured && (await featuredCount(tx, storeId)) >= MAX_FEATURED) fail("FEATURED_LIMIT");
    const slug =
      input.slug && input.slug !== current!.slug
        ? await uniqueProductSlug(tx, storeId, input.slug, id)
        : current!.slug;
    const options = assignValueIds(input.options);
    await tx.product.update({
      where: { id },
      data: {
        slug,
        titleBn: input.titleBn,
        titleEn: input.titleEn,
        descriptionBn: input.descriptionBn ?? null,
        descriptionEn: input.descriptionEn ?? null,
        categoryId: input.categoryId ?? null,
        status: input.status,
        isFeatured: input.isFeatured,
        featuredOrder: input.isFeatured
          ? (current!.featuredOrder ?? (await nextFeaturedOrder(tx, storeId)))
          : null,
        options,
      },
    });
    const existing = await tx.variant.findMany({
      where: { productId: id, deletedAt: null },
      select: variantSelect,
    });
    await applyVariants(tx, storeId, id, { slug, options }, input, existing);
    return { ok: true, id, slug };
  });
}

// ---------------------------------------------------------------------------
// Stock (optimistic concurrency)
// ---------------------------------------------------------------------------

export type StockResult =
  | { ok: true; stock: number; updatedAt: Date }
  | { ok: false; error: "NOT_FOUND" }
  | { ok: false; error: "STALE_UPDATE"; current: { stock: number; updatedAt: Date } };

/**
 * Sets a variant's stock only if nobody changed the variant since the editor
 * loaded it (`expectedUpdatedAt`). Otherwise returns STALE_UPDATE with the
 * current value instead of overwriting someone else's change.
 */
export async function setVariantStock(
  storeId: string,
  input: { variantId: string; stock: number; expectedUpdatedAt: Date },
): Promise<StockResult> {
  return withStore(storeId, async (tx): Promise<StockResult> => {
    const changed = await tx.variant.updateMany({
      where: { id: input.variantId, storeId, deletedAt: null, updatedAt: input.expectedUpdatedAt },
      data: { stock: input.stock },
    });
    const row = await tx.variant.findFirst({
      where: { id: input.variantId, storeId, deletedAt: null },
      select: { stock: true, updatedAt: true },
    });
    if (!row) return { ok: false, error: "NOT_FOUND" };
    if (changed.count === 0) return { ok: false, error: "STALE_UPDATE", current: row };
    return { ok: true, ...row };
  });
}

// ---------------------------------------------------------------------------
// Bulk actions, featured
// ---------------------------------------------------------------------------

export type BulkResult = { ok: true; count: number } | Fail;

export async function bulkUpdateProducts(
  storeId: string,
  input: { ids: string[]; action: BulkAction; categoryId?: string | null },
): Promise<BulkResult> {
  return transaction(storeId, async (tx): Promise<BulkResult> => {
    const where = { id: { in: input.ids }, storeId, deletedAt: null };
    switch (input.action) {
      case "publish":
      case "unpublish":
      case "archive": {
        const status =
          input.action === "publish" ? "ACTIVE" : input.action === "unpublish" ? "DRAFT" : "ARCHIVED";
        return { ok: true, count: (await tx.product.updateMany({ where, data: { status } })).count };
      }
      case "feature": {
        const toFeature = await tx.product.findMany({
          where: { ...where, isFeatured: false },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if ((await featuredCount(tx, storeId)) + toFeature.length > MAX_FEATURED) fail("FEATURED_LIMIT");
        let order = await nextFeaturedOrder(tx, storeId);
        for (const p of toFeature) {
          await tx.product.update({
            where: { id: p.id },
            data: { isFeatured: true, featuredOrder: order++ },
          });
        }
        return { ok: true, count: toFeature.length };
      }
      case "unfeature":
        return {
          ok: true,
          count: (await tx.product.updateMany({ where, data: { isFeatured: false, featuredOrder: null } }))
            .count,
        };
      case "move":
        await assertCategory(tx, storeId, input.categoryId);
        return {
          ok: true,
          count: (await tx.product.updateMany({ where, data: { categoryId: input.categoryId ?? null } }))
            .count,
        };
      case "delete":
        return { ok: true, count: await trash(tx, storeId, input.ids) };
    }
  });
}

/** Sets the featured order to `orderedIds` (all must be featured products of the store). */
export async function reorderFeatured(storeId: string, orderedIds: string[]): Promise<{ ok: true } | Fail> {
  return transaction(storeId, async (tx) => {
    const featured = await tx.product.findMany({
      where: { storeId, isFeatured: true, deletedAt: null },
      orderBy: [{ featuredOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const featuredIds = featured.map((f) => f.id);
    if (orderedIds.some((id) => !featuredIds.includes(id))) fail("NOT_FOUND");
    // Featured products missing from the list keep their relative order, after the listed ones.
    const order = [...new Set(orderedIds), ...featuredIds.filter((id) => !orderedIds.includes(id))];
    for (const [i, id] of order.entries())
      await tx.product.update({ where: { id }, data: { featuredOrder: i } });
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------------------
// Trash: soft delete, restore, permanent delete
// ---------------------------------------------------------------------------

async function trash(tx: TenantTx, storeId: string, ids: string[]) {
  // Trashed products leave the featured list (and the 12-item limit).
  const res = await tx.product.updateMany({
    where: { id: { in: ids }, storeId, deletedAt: null },
    data: { deletedAt: new Date(), isFeatured: false, featuredOrder: null },
  });
  return res.count;
}

export async function softDeleteProducts(
  storeId: string,
  ids: string[],
): Promise<{ ok: true; count: number }> {
  return withStore(storeId, async (tx) => ({ ok: true as const, count: await trash(tx, storeId, ids) }));
}

/**
 * Restores products from the trash. A slug taken in the meantime gets a -2/-3
 * suffix. (Their variants' SKUs stay reserved while in the trash.)
 */
export async function restoreProducts(storeId: string, ids: string[]): Promise<{ ok: true; count: number }> {
  return withStore(storeId, async (tx) => {
    const rows = await tx.product.findMany({
      where: { id: { in: ids }, storeId, deletedAt: { not: null } },
      select: { id: true, slug: true, categoryId: true },
    });
    for (const p of rows) {
      const slug = await uniqueProductSlug(tx, storeId, p.slug, p.id);
      await tx.product.update({ where: { id: p.id }, data: { deletedAt: null, slug } });
    }
    return { ok: true as const, count: rows.length };
  });
}

export type PermanentDeleteResult = {
  ok: true;
  count: number;
  deletedObjects: number;
  failedObjects: string[];
};

/**
 * OWNER only (the caller checks catalog:delete). Deletes trashed products' rows
 * (variants and image rows cascade; order items keep their snapshot and lose the
 * link) and then their image objects. Products not in the trash are ignored.
 */
export async function permanentlyDeleteProducts(
  storeId: string,
  ids: string[],
  storage: StorageProvider = getStorageProvider(),
): Promise<PermanentDeleteResult> {
  const keys = await withStore(storeId, async (tx) => {
    const rows = await tx.product.findMany({
      where: { id: { in: ids }, storeId, deletedAt: { not: null } },
      select: { id: true, images: { select: { key: true, thumbKey: true } } },
    });
    await tx.product.deleteMany({
      where: { id: { in: rows.map((r) => r.id) }, storeId, deletedAt: { not: null } },
    });
    return { count: rows.length, keys: rows.flatMap((r) => r.images.flatMap((i) => [i.key, i.thumbKey])) };
  });
  const results = await Promise.allSettled(keys.keys.map((k) => storage.delete(k)));
  const failedObjects = keys.keys.filter((_, i) => results[i]?.status === "rejected");
  return {
    ok: true,
    count: keys.count,
    deletedObjects: keys.keys.length - failedObjects.length,
    failedObjects,
  };
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

/**
 * Copies a product as a DRAFT: same texts/options/category, variants with new
 * SKUs and stock 0, and copies of the image objects under new keys (never the
 * same keys, so deleting one product can't break the other).
 */
export async function duplicateProduct(
  storeId: string,
  id: string,
  storage: StorageProvider = getStorageProvider(),
): Promise<SaveProductResult> {
  const copied: string[] = [];
  const cleanup = () => Promise.allSettled(copied.map((k) => storage.delete(k)));
  try {
    const result = await transaction(storeId, async (tx): Promise<SaveProductResult> => {
      const src = await tx.product.findFirst({
        where: { id, storeId, deletedAt: null },
        include: {
          variants: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
          images: { orderBy: { sortOrder: "asc" } },
        },
      });
      if (!src) fail("NOT_FOUND");
      const p = src!;
      const slug = await uniqueProductSlug(tx, storeId, `${p.slug}-copy`.slice(0, 80));
      const product = await tx.product.create({
        data: {
          storeId,
          slug,
          titleBn: `${p.titleBn} (কপি)`.slice(0, 200),
          titleEn: `${p.titleEn} (copy)`.slice(0, 200),
          descriptionBn: p.descriptionBn,
          descriptionEn: p.descriptionEn,
          categoryId: p.categoryId,
          status: "DRAFT",
          options: p.options ?? [],
        },
        select: { id: true, slug: true },
      });

      const imageIds = new Map<string, string>();
      for (const img of p.images) {
        const newKey = img.key.replace(/[^/]+(\.\w+)$/, `${createId()}$1`);
        const newThumb = img.thumbKey.replace(/[^/]+(\.\w+)$/, `${createId()}$1`);
        await storage.copy(img.key, newKey);
        copied.push(newKey);
        await storage.copy(img.thumbKey, newThumb);
        copied.push(newThumb);
        const row = await tx.productImage.create({
          data: {
            storeId,
            productId: product.id,
            key: newKey,
            thumbKey: newThumb,
            url: storage.publicUrl(newKey),
            thumbUrl: storage.publicUrl(newThumb),
            width: img.width,
            height: img.height,
            altBn: img.altBn,
            altEn: img.altEn,
            sortOrder: img.sortOrder,
          },
        });
        imageIds.set(img.id, row.id);
      }

      const used = new Set((await takenSkus(tx, storeId)).map((s) => s.toUpperCase()));
      for (const v of p.variants) {
        let sku = `${v.sku}-COPY`.slice(0, 64);
        for (let n = 2; used.has(sku.toUpperCase()); n++) sku = `${v.sku}-COPY${n}`.slice(0, 64);
        used.add(sku.toUpperCase());
        await tx.variant.create({
          data: {
            storeId,
            productId: product.id,
            sku,
            optionValues: v.optionValues ?? {},
            optionKey: v.optionKey,
            price: v.price,
            salePrice: v.salePrice,
            stock: 0,
            weightGrams: v.weightGrams,
            isActive: v.isActive,
            imageId: v.imageId ? (imageIds.get(v.imageId) ?? null) : null,
          },
        });
      }
      return { ok: true, ...product };
    });
    // A failed transaction leaves the copied objects unreferenced: remove them now.
    if (!result.ok) await cleanup();
    return result;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Reads used by the admin and the storefront
// ---------------------------------------------------------------------------

export type ProductVariantRow = {
  id: string;
  optionValues: OptionValues;
  optionKey: string;
  sku: string;
  price: number;
  salePrice: number | null;
  stock: number;
  weightGrams: number | null;
  imageId: string | null;
  isActive: boolean;
  updatedAt: Date;
};

/** A product with its live variants and images, for the editor. */
export async function getProductForEdit(storeId: string, id: string) {
  const p = await withStore(storeId, (tx) =>
    tx.product.findFirst({
      where: { id, storeId, deletedAt: null },
      include: {
        variants: { where: { deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    }),
  );
  if (!p) return null;
  return {
    ...p,
    options: sortAxes((p.options ?? []) as OptionAxis[]),
    variants: p.variants.map((v) => ({ ...v, optionValues: (v.optionValues ?? {}) as OptionValues })),
  };
}

export type { VariantFields };
