import { Prisma, withStore } from "@repo/db";
import { sortAxes, type OptionAxis, type OptionValues } from "./options";
import { LOW_STOCK, MAX_FEATURED } from "./schemas";

/*
 * Read models for the admin catalogue pages. All queries run through withStore(),
 * so RLS limits them to the store (raw SQL included: app.store_id is set in the
 * same transaction).
 */

export const PRODUCT_SORTS = ["newest", "name", "price", "stock"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];
export const STOCK_FILTERS = ["in", "low", "out"] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];
export const PAGE_SIZE = 20;

export type ProductFilters = {
  q?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  categoryId?: string;
  featured?: boolean;
  stock?: StockFilter;
  sort?: ProductSort;
  page?: number;
  /** For sort=name: which title to sort by. */
  locale?: "bn" | "en";
};

export type ListVariant = {
  id: string;
  optionValues: OptionValues;
  sku: string;
  price: number;
  salePrice: number | null;
  stock: number;
  isActive: boolean;
  updatedAt: Date;
};

export type ProductListRow = {
  id: string;
  slug: string;
  titleBn: string;
  titleEn: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  isFeatured: boolean;
  categoryId: string | null;
  options: OptionAxis[];
  coverThumbUrl: string | null;
  /** The cheapest active variant's effective price, with its regular price when on sale. */
  price: { amount: number; regular: number | null } | null;
  totalStock: number;
  variants: ListVariant[];
  createdAt: Date;
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** One page of the admin product list (20 per page) plus the total count. */
export async function listProducts(
  storeId: string,
  filters: ProductFilters = {},
): Promise<{ rows: ProductListRow[]; total: number; page: number; pages: number }> {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const where: Prisma.Sql[] = [Prisma.sql`p.store_id = ${storeId}`, Prisma.sql`p.deleted_at IS NULL`];
  if (filters.status) where.push(Prisma.sql`p.status = ${filters.status}::product_status`);
  if (filters.featured !== undefined) where.push(Prisma.sql`p.is_featured = ${filters.featured}`);
  if (filters.categoryId) {
    // The category and its children.
    where.push(Prisma.sql`(p.category_id = ${filters.categoryId}
      OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ${filters.categoryId} AND deleted_at IS NULL))`);
  }
  const q = filters.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(Prisma.sql`(p.title_bn ILIKE ${like} OR p.title_en ILIKE ${like}
      OR EXISTS (SELECT 1 FROM variants sv WHERE sv.product_id = p.id AND sv.deleted_at IS NULL AND sv.sku ILIKE ${like}))`);
  }
  if (filters.stock === "out") where.push(Prisma.sql`coalesce(s.stock, 0) = 0`);
  if (filters.stock === "low") where.push(Prisma.sql`coalesce(s.stock, 0) BETWEEN 1 AND ${LOW_STOCK}`);
  if (filters.stock === "in") where.push(Prisma.sql`coalesce(s.stock, 0) > ${LOW_STOCK}`);

  const title = filters.locale === "en" ? Prisma.sql`lower(p.title_en)` : Prisma.sql`p.title_bn`;
  const order =
    filters.sort === "name"
      ? Prisma.sql`${title} ASC, p.id`
      : filters.sort === "price"
        ? Prisma.sql`s.min_price ASC NULLS LAST, p.id`
        : filters.sort === "stock"
          ? Prisma.sql`coalesce(s.stock, 0) ASC, p.id`
          : Prisma.sql`p.created_at DESC, p.id`;

  return withStore(storeId, async (tx) => {
    const found = await tx.$queryRaw<{ id: string; total: bigint }[]>`
      SELECT p.id, count(*) OVER () AS total
      FROM products p
      LEFT JOIN LATERAL (
        SELECT min(coalesce(v.sale_price, v.price)) AS min_price, sum(v.stock)::int AS stock
        FROM variants v WHERE v.product_id = p.id AND v.deleted_at IS NULL AND v.is_active
      ) s ON true
      WHERE ${Prisma.join(where, " AND ")}
      ORDER BY ${order}
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`;
    const total = Number(found[0]?.total ?? 0);
    const ids = found.map((r) => r.id);
    const details = await tx.product.findMany({
      where: { id: { in: ids } },
      include: {
        images: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          take: 1,
          select: { thumbUrl: true },
        },
        variants: { where: { deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    const byId = new Map(details.map((d) => [d.id, d]));
    const rows = ids.map((id) => toRow(byId.get(id)!));
    return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  });
}

type ProductWithParts = Prisma.ProductGetPayload<{
  include: { images: { select: { thumbUrl: true } }; variants: true };
}>;

function toRow(p: ProductWithParts): ProductListRow {
  const variants: ListVariant[] = p.variants.map((v) => ({
    id: v.id,
    optionValues: (v.optionValues ?? {}) as OptionValues,
    sku: v.sku,
    price: v.price,
    salePrice: v.salePrice,
    stock: v.stock,
    isActive: v.isActive,
    updatedAt: v.updatedAt,
  }));
  const live = variants.filter((v) => v.isActive);
  const cheapest = [...live].sort((a, b) => (a.salePrice ?? a.price) - (b.salePrice ?? b.price))[0];
  return {
    id: p.id,
    slug: p.slug,
    titleBn: p.titleBn,
    titleEn: p.titleEn,
    status: p.status,
    isFeatured: p.isFeatured,
    categoryId: p.categoryId,
    options: sortAxes((p.options ?? []) as OptionAxis[]),
    coverThumbUrl: p.images[0]?.thumbUrl ?? null,
    price: cheapest
      ? {
          amount: cheapest.salePrice ?? cheapest.price,
          regular: cheapest.salePrice === null ? null : cheapest.price,
        }
      : null,
    totalStock: live.reduce((n, v) => n + v.stock, 0),
    variants,
    createdAt: p.createdAt,
  };
}

/** Products in the trash, newest deletion first. */
export async function listTrash(storeId: string) {
  return withStore(storeId, (tx) =>
    tx.product.findMany({
      where: { storeId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: {
        id: true,
        titleBn: true,
        titleEn: true,
        deletedAt: true,
        images: { orderBy: { sortOrder: "asc" }, take: 1, select: { thumbUrl: true } },
        _count: { select: { variants: { where: { deletedAt: null } }, images: true } },
      },
    }),
  );
}

/** Featured products in order, and the limit. */
export async function listFeatured(storeId: string) {
  const rows = await withStore(storeId, (tx) =>
    tx.product.findMany({
      where: { storeId, isFeatured: true, deletedAt: null },
      orderBy: [{ featuredOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        titleBn: true,
        titleEn: true,
        status: true,
        images: { orderBy: { sortOrder: "asc" }, take: 1, select: { thumbUrl: true } },
      },
    }),
  );
  return { rows, max: MAX_FEATURED };
}

/** Products that could be featured (not featured, not in the trash), for the "add" picker. */
export async function featuredCandidates(storeId: string) {
  return withStore(storeId, (tx) =>
    tx.product.findMany({
      where: { storeId, isFeatured: false, deletedAt: null },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: { id: true, titleBn: true, titleEn: true, status: true },
      take: 200,
    }),
  );
}

/** Dashboard numbers. */
export async function catalogStats(storeId: string) {
  return withStore(storeId, async (tx) => {
    const [active, drafts, outOfStock, lowStock, categories] = await Promise.all([
      tx.product.count({ where: { storeId, deletedAt: null, status: "ACTIVE" } }),
      tx.product.count({ where: { storeId, deletedAt: null, status: "DRAFT" } }),
      tx.variant.count({
        where: {
          storeId,
          deletedAt: null,
          isActive: true,
          stock: 0,
          product: { deletedAt: null, status: "ACTIVE" },
        },
      }),
      tx.variant.count({
        where: {
          storeId,
          deletedAt: null,
          isActive: true,
          stock: { gt: 0, lte: LOW_STOCK },
          product: { deletedAt: null, status: "ACTIVE" },
        },
      }),
      tx.category.count({ where: { storeId, deletedAt: null } }),
    ]);
    return { active, drafts, outOfStock, lowStock, categories };
  });
}

/** Flat category options for selects: parents, each followed by its children. */
export async function categoryOptions(storeId: string) {
  const rows = await withStore(storeId, (tx) =>
    tx.category.findMany({
      where: { storeId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, nameBn: true, nameEn: true, parentId: true },
    }),
  );
  const top = rows.filter((r) => !r.parentId);
  return top.flatMap((t) => [
    { ...t, depth: 0 },
    ...rows.filter((r) => r.parentId === t.id).map((c) => ({ ...c, depth: 1 })),
  ]);
}
