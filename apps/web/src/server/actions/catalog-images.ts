"use server";

import {
  deleteProductImage,
  imageMetaSchema,
  linkImageToColour,
  reorderProductImages,
  updateImageAlt,
} from "@repo/core";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requirePermission } from "../auth";
import { failure, validationFailure } from "../i18n";

/*
 * Photo management for the product editor (OWNER and STAFF: catalog:manage).
 * Uploads go through the route handler /api/admin/products/[id]/images instead,
 * for progress reporting.
 */

const id = z.string().min(1).max(40);

export async function reorderImagesAction(productId: string, orderedIds: string[]): Promise<ActionResult> {
  const { store } = await requirePermission("catalog:manage");
  const parsed = z
    .object({ productId: id, orderedIds: z.array(id).max(20) })
    .safeParse({ productId, orderedIds });
  if (!parsed.success) return failure("INVALID");
  const r = await reorderProductImages(store.id, parsed.data.productId, parsed.data.orderedIds);
  return r.ok ? { ok: true } : failure(r.error);
}

export async function updateImageAltAction(
  imageId: string,
  altBn: string,
  altEn: string,
): Promise<ActionResult> {
  const { store } = await requirePermission("catalog:manage");
  const parsed = imageMetaSchema.safeParse({ altBn, altEn });
  if (!parsed.success) return validationFailure(parsed.error);
  if (!id.safeParse(imageId).success) return failure("IMAGE_NOT_FOUND");
  const r = await updateImageAlt(store.id, imageId, parsed.data);
  return r.ok ? { ok: true } : failure(r.error);
}

export async function deleteImageAction(imageId: string): Promise<ActionResult> {
  const { store } = await requirePermission("catalog:manage");
  if (!id.safeParse(imageId).success) return failure("IMAGE_NOT_FOUND");
  const r = await deleteProductImage(store.id, imageId);
  return r.ok ? { ok: true } : failure(r.error);
}

/** Shows `imageId` (or none) for every variant with this colour. */
export async function linkColourImageAction(
  productId: string,
  colourValueId: string,
  imageId: string | null,
): Promise<ActionResult> {
  const { store } = await requirePermission("catalog:manage");
  const parsed = z
    .object({ productId: id, colourValueId: id, imageId: id.nullable() })
    .safeParse({ productId, colourValueId, imageId });
  if (!parsed.success) return failure("INVALID");
  const r = await linkImageToColour(store.id, productId, colourValueId, imageId);
  return r.ok ? { ok: true, data: { count: r.count } } : failure(r.error);
}
