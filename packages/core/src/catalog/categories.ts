import { withStore, type TenantTx } from "@repo/db";
import { getStorageProvider, type StorageProvider } from "../storage";
import type { CategoryInput } from "./schemas";
import { baseSlug, nextFreeSlug } from "./slug";

/*
 * Categories: two levels at most (a child can't have children), bilingual names,
 * soft delete. Everything runs through withStore(), so RLS scopes every query to
 * the store; the explicit storeId filters are defence in depth.
 */

export type CategoryError = "NOT_FOUND" | "PARENT_NOT_FOUND" | "CATEGORY_DEPTH" | "CATEGORY_HAS_PRODUCTS";

export type CategoryResult =
  | { ok: true; id: string; slug: string }
  | { ok: false; error: Exclude<CategoryError, "CATEGORY_HAS_PRODUCTS"> };

/** A slug that no other non-deleted category of the store uses (base, base-2, …). */
export async function uniqueCategorySlug(tx: TenantTx, storeId: string, base: string, excludeId?: string) {
  const rows = await tx.category.findMany({
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

/** Checks the parent for a category (null = top level). */
async function checkParent(
  tx: TenantTx,
  storeId: string,
  parentId: string | null | undefined,
  selfId?: string,
): Promise<CategoryError | null> {
  if (!parentId) return null;
  if (parentId === selfId) return "CATEGORY_DEPTH";
  const parent = await tx.category.findFirst({
    where: { id: parentId, storeId, deletedAt: null },
    select: { parentId: true },
  });
  if (!parent) return "PARENT_NOT_FOUND";
  if (parent.parentId) return "CATEGORY_DEPTH"; // the parent is already a child
  if (selfId) {
    const children = await tx.category.count({ where: { parentId: selfId, deletedAt: null } });
    if (children > 0) return "CATEGORY_DEPTH"; // a parent can't become a child
  }
  return null;
}

async function nextSortOrder(tx: TenantTx, storeId: string, parentId: string | null) {
  const last = await tx.category.aggregate({
    where: { storeId, parentId, deletedAt: null },
    _max: { sortOrder: true },
  });
  return (last._max.sortOrder ?? -1) + 1;
}

export async function createCategory(storeId: string, input: CategoryInput): Promise<CategoryResult> {
  return withStore(storeId, async (tx): Promise<CategoryResult> => {
    const parentId = input.parentId ?? null;
    const problem = await checkParent(tx, storeId, parentId);
    if (problem) return { ok: false, error: problem as Exclude<CategoryError, "CATEGORY_HAS_PRODUCTS"> };
    const slug = await uniqueCategorySlug(tx, storeId, input.slug ?? baseSlug(input.nameEn, input.nameBn));
    const created = await tx.category.create({
      data: {
        storeId,
        slug,
        nameBn: input.nameBn,
        nameEn: input.nameEn,
        descriptionBn: input.descriptionBn ?? null,
        descriptionEn: input.descriptionEn ?? null,
        parentId,
        isActive: input.isActive,
        sortOrder: await nextSortOrder(tx, storeId, parentId),
      },
      select: { id: true, slug: true },
    });
    return { ok: true, ...created };
  });
}

export async function updateCategory(
  storeId: string,
  id: string,
  input: CategoryInput,
): Promise<CategoryResult> {
  return withStore(storeId, async (tx): Promise<CategoryResult> => {
    const current = await tx.category.findFirst({ where: { id, storeId, deletedAt: null } });
    if (!current) return { ok: false, error: "NOT_FOUND" };
    const parentId = input.parentId === undefined ? current.parentId : input.parentId;
    const problem = await checkParent(tx, storeId, parentId, id);
    if (problem) return { ok: false, error: problem as Exclude<CategoryError, "CATEGORY_HAS_PRODUCTS"> };
    const slug =
      input.slug && input.slug !== current.slug
        ? await uniqueCategorySlug(tx, storeId, input.slug, id)
        : current.slug;
    await tx.category.update({
      where: { id },
      data: {
        slug,
        nameBn: input.nameBn,
        nameEn: input.nameEn,
        descriptionBn: input.descriptionBn ?? null,
        descriptionEn: input.descriptionEn ?? null,
        parentId,
        isActive: input.isActive,
        // Moving to another parent puts it last there.
        ...(parentId !== current.parentId ? { sortOrder: await nextSortOrder(tx, storeId, parentId) } : {}),
      },
    });
    return { ok: true, id, slug };
  });
}

/** Swaps a category with its previous/next sibling. */
export async function moveCategory(
  storeId: string,
  id: string,
  direction: "up" | "down",
): Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" }> {
  return withStore(storeId, async (tx) => {
    const current = await tx.category.findFirst({
      where: { id, storeId, deletedAt: null },
      select: { parentId: true },
    });
    if (!current) return { ok: false as const, error: "NOT_FOUND" as const };
    const siblings = await tx.category.findMany({
      where: { storeId, parentId: current.parentId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const ids = siblings.map((s) => s.id);
    const i = ids.indexOf(id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    // Renumber 0..n-1, which also repairs gaps and duplicates.
    for (const [n, cid] of ids.entries())
      await tx.category.update({ where: { id: cid }, data: { sortOrder: n } });
    return { ok: true as const };
  });
}

export type DeleteCategoryResult =
  | { ok: true; uncategorised: number; promoted: number }
  | { ok: false; error: "NOT_FOUND" }
  | { ok: false; error: "CATEGORY_HAS_PRODUCTS"; productCount: number };

/** Products in a category (not counting the trash), for the delete confirmation. */
export async function categoryProductCount(storeId: string, id: string): Promise<number> {
  return withStore(storeId, (tx) =>
    tx.product.count({ where: { storeId, categoryId: id, deletedAt: null } }),
  );
}

/**
 * Soft-deletes a category. With products in it, the caller must confirm first
 * (CATEGORY_HAS_PRODUCTS + count); its products become uncategorised and its
 * children move to the top level. The image object is deleted.
 */
export async function deleteCategory(
  storeId: string,
  id: string,
  options: { confirm?: boolean; storage?: StorageProvider } = {},
): Promise<DeleteCategoryResult> {
  const result = await withStore(storeId, async (tx) => {
    const current = await tx.category.findFirst({ where: { id, storeId, deletedAt: null } });
    if (!current) return { ok: false as const, error: "NOT_FOUND" as const };
    const productCount = await tx.product.count({ where: { storeId, categoryId: id, deletedAt: null } });
    if (productCount > 0 && !options.confirm) {
      return { ok: false as const, error: "CATEGORY_HAS_PRODUCTS" as const, productCount };
    }
    // Trashed products too, so a restored product doesn't point at a deleted category.
    const uncategorised = await tx.product.updateMany({
      where: { storeId, categoryId: id },
      data: { categoryId: null },
    });
    const promoted = await tx.category.updateMany({
      where: { storeId, parentId: id },
      data: { parentId: null },
    });
    await tx.category.update({
      where: { id },
      data: { deletedAt: new Date(), parentId: null, imageKey: null, imageUrl: null },
    });
    return {
      ok: true as const,
      uncategorised: uncategorised.count,
      promoted: promoted.count,
      imageKey: current.imageKey,
    };
  });
  if (!result.ok) return result;
  if (result.imageKey) {
    await (options.storage ?? getStorageProvider()).delete(result.imageKey).catch(() => {
      // Best effort: the storage sweep removes it later.
    });
  }
  return { ok: true, uncategorised: result.uncategorised, promoted: result.promoted };
}

export type CategoryNode = {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string;
  descriptionBn: string | null;
  descriptionEn: string | null;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  parentId: string | null;
  productCount: number;
  children: CategoryNode[];
};

/** The category tree (parents → children, in sort order) with product counts (trash excluded). */
export async function listCategoryTree(storeId: string): Promise<CategoryNode[]> {
  const rows = await withStore(storeId, (tx) =>
    tx.category.findMany({
      where: { storeId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { products: { where: { deletedAt: null } } } } },
    }),
  );
  const node = (c: (typeof rows)[number]): CategoryNode => ({
    id: c.id,
    slug: c.slug,
    nameBn: c.nameBn,
    nameEn: c.nameEn,
    descriptionBn: c.descriptionBn,
    descriptionEn: c.descriptionEn,
    imageUrl: c.imageUrl,
    isActive: c.isActive,
    sortOrder: c.sortOrder,
    parentId: c.parentId,
    productCount: c._count.products,
    children: [],
  });
  const top = rows.filter((c) => !c.parentId).map(node);
  const byId = new Map(top.map((n) => [n.id, n]));
  for (const c of rows) if (c.parentId) byId.get(c.parentId)?.children.push(node(c));
  return top;
}
