import { Prisma, withStore } from "@repo/db";
import { sortAxes, type OptionAxis, type OptionValues } from "./options";

/*
 * Storefront read models. Visibility rules, in one place:
 *   - products: status ACTIVE and not deleted (DRAFT, ARCHIVED, trashed → not found);
 *   - variants: active and not deleted;
 *   - categories: active and not deleted (a child also needs an active parent).
 * Everything runs through withStore(), so RLS limits it to the store.
 */

export const STOREFRONT_PAGE_SIZE = 24;
export const STOREFRONT_SORTS = ["newest", "price-asc", "price-desc"] as const;
export type StorefrontSort = (typeof STOREFRONT_SORTS)[number];

export type ProductCardData = {
  id: string;
  slug: string;
  titleBn: string;
  titleEn: string;
  thumbUrl: string | null;
  altBn: string | null;
  altEn: string | null;
  /** Cheapest active variant: the price to pay, and its regular price when on sale. */
  price: number | null;
  regularPrice: number | null;
  inStock: boolean;
};

const visibleProduct = (storeId: string) =>
  ({ storeId, status: "ACTIVE", deletedAt: null }) satisfies Prisma.ProductWhereInput;
const liveVariant = { deletedAt: null, isActive: true } satisfies Prisma.VariantWhereInput;

const cardSelect = {
  id: true,
  slug: true,
  titleBn: true,
  titleEn: true,
  images: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 1,
    select: { thumbUrl: true, altBn: true, altEn: true },
  },
  variants: { where: liveVariant, select: { price: true, salePrice: true, stock: true } },
} satisfies Prisma.ProductSelect;

type CardRow = Prisma.ProductGetPayload<{ select: typeof cardSelect }>;

function toCard(p: CardRow): ProductCardData {
  const cheapest = [...p.variants].sort((a, b) => (a.salePrice ?? a.price) - (b.salePrice ?? b.price))[0];
  return {
    id: p.id,
    slug: p.slug,
    titleBn: p.titleBn,
    titleEn: p.titleEn,
    thumbUrl: p.images[0]?.thumbUrl ?? null,
    altBn: p.images[0]?.altBn ?? null,
    altEn: p.images[0]?.altEn ?? null,
    price: cheapest ? (cheapest.salePrice ?? cheapest.price) : null,
    regularPrice: cheapest && cheapest.salePrice !== null ? cheapest.price : null,
    inStock: p.variants.some((v) => v.stock > 0),
  };
}

/** Categories a shopper may see (active, not deleted; children only under a visible parent). */
async function visibleCategories(tx: Prisma.TransactionClient, storeId: string) {
  const rows = await tx.category.findMany({
    where: { storeId, deletedAt: null, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      slug: true,
      nameBn: true,
      nameEn: true,
      imageUrl: true,
      parentId: true,
      descriptionBn: true,
      descriptionEn: true,
    },
  });
  const topIds = new Set(rows.filter((r) => !r.parentId).map((r) => r.id));
  return rows.filter((r) => !r.parentId || topIds.has(r.parentId));
}

/** Home page: featured (in featured order), top-level categories with images, newest products. */
export async function storefrontHome(storeId: string, newest = 8) {
  return withStore(storeId, async (tx) => {
    const [featured, latest, categories] = await Promise.all([
      tx.product.findMany({
        where: { ...visibleProduct(storeId), isFeatured: true },
        orderBy: [{ featuredOrder: "asc" }, { createdAt: "asc" }],
        select: cardSelect,
      }),
      tx.product.findMany({
        where: visibleProduct(storeId),
        orderBy: { createdAt: "desc" },
        take: newest,
        select: cardSelect,
      }),
      visibleCategories(tx, storeId),
    ]);
    return {
      featured: featured.map(toCard),
      newest: latest.map(toCard),
      categories: categories.filter((c) => !c.parentId),
    };
  });
}

/**
 * A category page: the category, its visible children, and the visible products
 * in it and its children. Null when the category isn't visible (→ 404).
 */
export async function storefrontCategory(
  storeId: string,
  slug: string,
  options: { sort?: StorefrontSort; page?: number } = {},
) {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  return withStore(storeId, async (tx) => {
    const categories = await visibleCategories(tx, storeId);
    const category = categories.find((c) => c.slug === slug);
    if (!category) return null;
    const children = categories.filter((c) => c.parentId === category.id);
    const parent = category.parentId ? (categories.find((c) => c.id === category.parentId) ?? null) : null;
    const categoryIds = [category.id, ...children.map((c) => c.id)];

    const order =
      options.sort === "price-asc"
        ? Prisma.sql`s.min_price ASC NULLS LAST, p.id`
        : options.sort === "price-desc"
          ? Prisma.sql`s.min_price DESC NULLS LAST, p.id`
          : Prisma.sql`p.created_at DESC, p.id`;
    const found = await tx.$queryRaw<{ id: string; total: bigint }[]>`
      SELECT p.id, count(*) OVER () AS total
      FROM products p
      LEFT JOIN LATERAL (
        SELECT min(coalesce(v.sale_price, v.price)) AS min_price
        FROM variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL AND v.is_active
      ) s ON true
      WHERE p.store_id = ${storeId} AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
        AND p.category_id IN (${Prisma.join(categoryIds)})
      ORDER BY ${order}
      LIMIT ${STOREFRONT_PAGE_SIZE} OFFSET ${(page - 1) * STOREFRONT_PAGE_SIZE}`;
    const ids = found.map((r) => r.id);
    const rows = await tx.product.findMany({ where: { id: { in: ids } }, select: cardSelect });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const total = Number(found[0]?.total ?? 0);
    return {
      category,
      parent,
      children,
      products: ids.map((id) => toCard(byId.get(id)!)),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / STOREFRONT_PAGE_SIZE)),
    };
  });
}

export type StorefrontVariant = {
  id: string;
  optionValues: OptionValues;
  price: number;
  salePrice: number | null;
  stock: number;
  imageId: string | null;
};

/** A product page, or null when the product isn't visible (→ 404). */
export async function storefrontProduct(storeId: string, slug: string) {
  return withStore(storeId, async (tx) => {
    const p = await tx.product.findFirst({
      where: { ...visibleProduct(storeId), slug },
      include: {
        images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        variants: { where: liveVariant, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        category: { select: { slug: true, nameBn: true, nameEn: true, isActive: true, deletedAt: true } },
      },
    });
    if (!p) return null;
    const category = p.category && p.category.isActive && !p.category.deletedAt ? p.category : null;
    return {
      id: p.id,
      slug: p.slug,
      titleBn: p.titleBn,
      titleEn: p.titleEn,
      descriptionBn: p.descriptionBn,
      descriptionEn: p.descriptionEn,
      options: sortAxes((p.options ?? []) as OptionAxis[]),
      images: p.images.map((i) => ({
        id: i.id,
        url: i.url,
        thumbUrl: i.thumbUrl,
        width: i.width,
        height: i.height,
        altBn: i.altBn,
        altEn: i.altEn,
      })),
      variants: p.variants.map(
        (v): StorefrontVariant => ({
          id: v.id,
          optionValues: (v.optionValues ?? {}) as OptionValues,
          price: v.price,
          salePrice: v.salePrice,
          stock: v.stock,
          imageId: v.imageId,
        }),
      ),
      category: category ? { slug: category.slug, nameBn: category.nameBn, nameEn: category.nameEn } : null,
    };
  });
}
