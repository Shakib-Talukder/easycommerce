"use server";

import {
  BULK_ACTIONS,
  bulkInputSchema,
  bulkUpdateProducts,
  categoryInputSchema,
  createCategory,
  createProduct,
  deleteCategory,
  duplicateProduct,
  moveCategory,
  permanentlyDeleteProducts,
  productInputSchema,
  removeCategoryImage,
  reorderFeatured,
  restoreProducts,
  setCategoryImage,
  setVariantStock,
  softDeleteProducts,
  stockUpdateSchema,
  updateCategory,
  updateProduct,
  listFeatured,
} from "@repo/core";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult, ActionState } from "@/lib/action-result";
import { requirePermission } from "../auth";
import { failure, getErrorTranslator, validationFailure } from "../i18n";

/*
 * Catalogue mutations. OWNER and STAFF (catalog:manage); permanent deletion is
 * OWNER only (catalog:delete). Validation and rules live in @repo/core/catalog.
 */

const id = z.string().min(1).max(40);
const ids = (formData: FormData) =>
  formData
    .getAll("ids")
    .map(String)
    .filter((v) => id.safeParse(v).success);

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/**
 * Create or update a product from the editor. The editor posts its state as one
 * JSON field (`payload`), validated by productInputSchema. Field errors are keyed
 * by path ("titleBn", "variants.3.salePrice", "options.1.values.0.en").
 */
export async function saveProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { store } = await requirePermission("catalog:manage");
  const productId = formData.get("productId");
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return failure("INVALID");
  }
  const parsed = productInputSchema.safeParse(payload);
  if (!parsed.success) {
    const te = await getErrorTranslator();
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues)
      (fieldErrors[issue.path.join(".") || "form"] ??= []).push(te(issue.message));
    return { ok: false, code: "VALIDATION", message: te("VALIDATION"), fieldErrors };
  }

  const result =
    typeof productId === "string" && productId
      ? await updateProduct(store.id, productId, parsed.data)
      : await createProduct(store.id, parsed.data);
  if (!result.ok) {
    const state = await failure(result.error);
    // A variant-level rule: point the error at that row (detail = option key or SKU).
    if (!state.ok && result.detail) state.data = { detail: result.detail };
    return state;
  }
  revalidatePath("/admin/products");
  redirect(`/admin/products/${result.id}?saved=1`);
}

/** Quick stock edit (list and editor) with optimistic concurrency. */
export async function quickStockAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { store } = await requirePermission("catalog:manage");
  const parsed = stockUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const r = await setVariantStock(store.id, parsed.data);
  if (r.ok) {
    revalidatePath("/admin/products");
    return {
      ok: true,
      message: (await getTranslations("catalog.list"))("quickStock.saved"),
      data: { stock: r.stock, updatedAt: r.updatedAt.toISOString() },
    };
  }
  if (r.error === "STALE_UPDATE") {
    return failure("STALE_UPDATE", {
      data: { stock: r.current.stock, updatedAt: r.current.updatedAt.toISOString() },
    });
  }
  return failure(r.error);
}

export async function bulkProductsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { store } = await requirePermission("catalog:manage");
  const action = formData.get("action");
  const parsed = bulkInputSchema.safeParse({
    ids: ids(formData),
    action: BULK_ACTIONS.includes(action as (typeof BULK_ACTIONS)[number]) ? action : undefined,
    categoryId: formData.get("categoryId") ?? undefined,
  });
  if (!parsed.success) return validationFailure(parsed.error);
  const r = await bulkUpdateProducts(store.id, parsed.data);
  if (!r.ok) return failure(r.error);
  revalidatePath("/admin/products");
  return { ok: true, message: (await getTranslations("catalog.list"))("bulk.done", { count: r.count }) };
}

export async function duplicateProductAction(formData: FormData): Promise<void> {
  const { store } = await requirePermission("catalog:manage");
  const productId = id.parse(formData.get("productId"));
  const r = await duplicateProduct(store.id, productId);
  if (!r.ok) redirect(`/admin/products/${productId}?error=${r.error}`);
  revalidatePath("/admin/products");
  redirect(`/admin/products/${r.id}?duplicated=1`);
}

export async function trashProductAction(formData: FormData): Promise<void> {
  const { store } = await requirePermission("catalog:manage");
  await softDeleteProducts(store.id, [id.parse(formData.get("productId"))]);
  revalidatePath("/admin/products");
  redirect("/admin/products?trashed=1");
}

export async function restoreProductsAction(formData: FormData): Promise<void> {
  const { store } = await requirePermission("catalog:manage");
  await restoreProducts(store.id, ids(formData));
  revalidatePath("/admin/products");
  redirect("/admin/products/trash?restored=1");
}

/** OWNER only: deletes trashed products' rows and image objects for good. */
export async function permanentDeleteAction(formData: FormData): Promise<void> {
  const { store } = await requirePermission("catalog:delete");
  await permanentlyDeleteProducts(store.id, ids(formData));
  revalidatePath("/admin/products");
  redirect("/admin/products/trash?deleted=1");
}

// ---------------------------------------------------------------------------
// Featured
// ---------------------------------------------------------------------------

export async function addFeaturedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { store } = await requirePermission("catalog:manage");
  const productId = id.safeParse(formData.get("productId"));
  if (!productId.success) return failure("NOTHING_SELECTED");
  const r = await bulkUpdateProducts(store.id, { ids: [productId.data], action: "feature" });
  if (!r.ok) return failure(r.error);
  revalidatePath("/admin/products/featured");
  return { ok: true };
}

export async function removeFeaturedAction(formData: FormData): Promise<void> {
  const { store } = await requirePermission("catalog:manage");
  await bulkUpdateProducts(store.id, { ids: [id.parse(formData.get("productId"))], action: "unfeature" });
  revalidatePath("/admin/products/featured");
}

export async function moveFeaturedAction(formData: FormData): Promise<void> {
  const { store } = await requirePermission("catalog:manage");
  const productId = id.parse(formData.get("productId"));
  const direction = formData.get("direction") === "up" ? -1 : 1;
  const order = (await listFeatured(store.id)).rows.map((r) => r.id);
  const i = order.indexOf(productId);
  const j = i + direction;
  if (i >= 0 && j >= 0 && j < order.length) [order[i], order[j]] = [order[j]!, order[i]!];
  await reorderFeatured(store.id, order);
  revalidatePath("/admin/products/featured");
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function saveCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { store } = await requirePermission("catalog:manage");
  const parsed = categoryInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const categoryId = formData.get("categoryId");
  const r =
    typeof categoryId === "string" && categoryId
      ? await updateCategory(store.id, categoryId, parsed.data)
      : await createCategory(store.id, parsed.data);
  if (!r.ok) {
    const state = await failure(r.error);
    return r.error === "CATEGORY_DEPTH" || r.error === "PARENT_NOT_FOUND"
      ? {
          ...(state as Extract<ActionResult, { ok: false }>),
          fieldErrors: { parentId: [state.ok ? "" : state.message] },
        }
      : state;
  }
  revalidatePath("/admin/categories");
  return { ok: true, message: (await getTranslations("catalog.categories"))("saved"), data: { id: r.id } };
}

export async function moveCategoryAction(formData: FormData): Promise<void> {
  const { store } = await requirePermission("catalog:manage");
  await moveCategory(
    store.id,
    id.parse(formData.get("categoryId")),
    formData.get("direction") === "up" ? "up" : "down",
  );
  revalidatePath("/admin/categories");
}

/** First call returns CATEGORY_HAS_PRODUCTS with the count; the confirmation posts confirm=1. */
export async function deleteCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { store } = await requirePermission("catalog:manage");
  const categoryId = id.safeParse(formData.get("categoryId"));
  if (!categoryId.success) return failure("NOT_FOUND");
  const r = await deleteCategory(store.id, categoryId.data, { confirm: formData.get("confirm") === "1" });
  if (!r.ok) {
    if (r.error === "CATEGORY_HAS_PRODUCTS") {
      return failure(r.error, { data: { productCount: r.productCount } });
    }
    return failure(r.error);
  }
  revalidatePath("/admin/categories");
  return { ok: true, message: (await getTranslations("catalog.categories"))("deleted") };
}

/** Category image: compressed in the browser like product photos, processed by the same pipeline. */
export async function uploadCategoryImageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { store } = await requirePermission("catalog:manage");
  const categoryId = id.safeParse(formData.get("categoryId"));
  const file = formData.get("image");
  if (!categoryId.success) return failure("NOT_FOUND");
  if (!(file instanceof File) || file.size === 0) return failure("UPLOAD_MISSING");
  const r = await setCategoryImage(store.id, categoryId.data, Buffer.from(await file.arrayBuffer()));
  if (!r.ok) return failure(r.error, undefined, "values" in r ? r.values : undefined);
  revalidatePath("/admin/categories");
  return { ok: true, data: { url: r.url } };
}

export async function removeCategoryImageAction(formData: FormData): Promise<void> {
  const { store } = await requirePermission("catalog:manage");
  await removeCategoryImage(store.id, id.parse(formData.get("categoryId")));
  revalidatePath("/admin/categories");
}
