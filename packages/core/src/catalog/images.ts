import { withStore } from "@repo/db";
import { ImageUploadError, assertStoreKey, processAndStoreImage, type StoredImage } from "../images";
import { getStorageProvider, type StorageProvider } from "../storage";
import { MAX_IMAGES_PER_PRODUCT } from "./schemas";

/*
 * Product photos (and category images). Uploads go through processAndStoreImage
 * (magic bytes, ≤ 5 MB, ≥ 300 px, ≤ 40 MP, EXIF stripped, 1600 px WebP + 400 px
 * thumb). Objects are removed again if the database write fails.
 */

export type ImageError = "NOT_FOUND" | "IMAGE_LIMIT" | "IMAGE_NOT_FOUND";

export type ProductImageRow = {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  altBn: string | null;
  altEn: string | null;
  sortOrder: number;
};

const imageSelect = {
  id: true,
  url: true,
  thumbUrl: true,
  width: true,
  height: true,
  altBn: true,
  altEn: true,
  sortOrder: true,
} as const;

export type AddImageResult =
  | { ok: true; image: ProductImageRow }
  | { ok: false; error: "NOT_FOUND" | "IMAGE_LIMIT" }
  | { ok: false; error: ImageUploadError["code"]; values: Record<string, number> };

async function imageCount(storeId: string, productId: string) {
  return withStore(storeId, async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: productId, storeId, deletedAt: null },
      select: { id: true },
    });
    return product ? tx.productImage.count({ where: { productId } }) : null;
  });
}

/**
 * Adds a photo to a product (at most MAX_IMAGES_PER_PRODUCT). The limit is checked
 * before the (slow) image processing and again, under a row lock on the product,
 * when the row is inserted, so parallel uploads can't exceed it.
 */
export async function addProductImage(
  storeId: string,
  productId: string,
  data: Buffer,
  storage: StorageProvider = getStorageProvider(),
): Promise<AddImageResult> {
  const count = await imageCount(storeId, productId);
  if (count === null) return { ok: false, error: "NOT_FOUND" };
  if (count >= MAX_IMAGES_PER_PRODUCT) return { ok: false, error: "IMAGE_LIMIT" };

  let files: { image: StoredImage; thumb: StoredImage };
  try {
    files = (await processAndStoreImage("product", { storeId, data, storage })).variants;
  } catch (error) {
    if (error instanceof ImageUploadError) return { ok: false, error: error.code, values: error.values };
    throw error;
  }
  const removeFiles = () =>
    Promise.allSettled([storage.delete(files.image.key), storage.delete(files.thumb.key)]);

  try {
    assertStoreKey(storeId, files.image.key, "product");
    assertStoreKey(storeId, files.thumb.key, "product");
    const result = await withStore(storeId, async (tx): Promise<AddImageResult> => {
      // Serialise concurrent uploads to the same product.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM products WHERE id = ${productId} AND store_id = ${storeId} AND deleted_at IS NULL FOR UPDATE`;
      if (locked.length === 0) return { ok: false, error: "NOT_FOUND" };
      const agg = await tx.productImage.aggregate({
        where: { productId },
        _count: true,
        _max: { sortOrder: true },
      });
      if (agg._count >= MAX_IMAGES_PER_PRODUCT) return { ok: false, error: "IMAGE_LIMIT" };
      const image = await tx.productImage.create({
        data: {
          storeId,
          productId,
          key: files.image.key,
          url: files.image.url,
          thumbKey: files.thumb.key,
          thumbUrl: files.thumb.url,
          width: files.image.width,
          height: files.image.height,
          sortOrder: (agg._max.sortOrder ?? -1) + 1,
        },
        select: imageSelect,
      });
      return { ok: true, image };
    });
    if (!result.ok) await removeFiles();
    return result;
  } catch (error) {
    await removeFiles();
    throw error;
  }
}

export async function listProductImages(storeId: string, productId: string): Promise<ProductImageRow[]> {
  return withStore(storeId, (tx) =>
    tx.productImage.findMany({
      where: { productId, storeId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: imageSelect,
    }),
  );
}

export async function updateImageAlt(
  storeId: string,
  imageId: string,
  alt: { altBn?: string; altEn?: string },
): Promise<{ ok: true } | { ok: false; error: "IMAGE_NOT_FOUND" }> {
  const res = await withStore(storeId, (tx) =>
    tx.productImage.updateMany({
      where: { id: imageId, storeId },
      data: { altBn: alt.altBn ?? null, altEn: alt.altEn ?? null },
    }),
  );
  return res.count ? { ok: true } : { ok: false, error: "IMAGE_NOT_FOUND" };
}

/**
 * Sets the photo order (the first is the cover). `orderedIds` must be the
 * product's images; any missing ones keep their relative order after them.
 */
export async function reorderProductImages(
  storeId: string,
  productId: string,
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" | "IMAGE_NOT_FOUND" }> {
  return withStore(storeId, async (tx) => {
    const rows = await tx.productImage.findMany({
      where: { productId, storeId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (rows.length === 0) return { ok: false as const, error: "NOT_FOUND" as const };
    const ids = rows.map((r) => r.id);
    if (orderedIds.some((id) => !ids.includes(id)))
      return { ok: false as const, error: "IMAGE_NOT_FOUND" as const };
    const order = [...new Set(orderedIds), ...ids.filter((id) => !orderedIds.includes(id))];
    for (const [i, id] of order.entries())
      await tx.productImage.update({ where: { id }, data: { sortOrder: i } });
    return { ok: true as const };
  });
}

/** Makes `imageId` the cover (first) photo. */
export async function setCoverImage(storeId: string, productId: string, imageId: string) {
  return reorderProductImages(storeId, productId, [imageId]);
}

/** Deletes a photo row (variants linked to it lose the link) and then its objects. */
export async function deleteProductImage(
  storeId: string,
  imageId: string,
  storage: StorageProvider = getStorageProvider(),
): Promise<{ ok: true } | { ok: false; error: "IMAGE_NOT_FOUND" }> {
  const row = await withStore(storeId, async (tx) => {
    const img = await tx.productImage.findFirst({
      where: { id: imageId, storeId },
      select: { key: true, thumbKey: true },
    });
    if (img) await tx.productImage.delete({ where: { id: imageId } });
    return img;
  });
  if (!row) return { ok: false, error: "IMAGE_NOT_FOUND" };
  await Promise.allSettled([storage.delete(row.key), storage.delete(row.thumbKey)]);
  return { ok: true };
}

/**
 * Links a photo to a colour value: every (live) variant of the product with that
 * colour shows it (variant.image_id). `imageId` null removes the link.
 */
export async function linkImageToColour(
  storeId: string,
  productId: string,
  colourValueId: string,
  imageId: string | null,
): Promise<{ ok: true; count: number } | { ok: false; error: "NOT_FOUND" | "IMAGE_NOT_FOUND" }> {
  return withStore(storeId, async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: productId, storeId, deletedAt: null },
      select: { id: true },
    });
    if (!product) return { ok: false as const, error: "NOT_FOUND" as const };
    if (imageId) {
      const img = await tx.productImage.findFirst({
        where: { id: imageId, productId, storeId },
        select: { id: true },
      });
      if (!img) return { ok: false as const, error: "IMAGE_NOT_FOUND" as const };
    }
    const res = await tx.variant.updateMany({
      where: {
        productId,
        storeId,
        deletedAt: null,
        optionValues: { path: ["colour"], equals: colourValueId },
      },
      data: { imageId },
    });
    return { ok: true as const, count: res.count };
  });
}

export type CategoryImageResult =
  | { ok: true; url: string }
  | { ok: false; error: "NOT_FOUND" }
  | { ok: false; error: ImageUploadError["code"]; values: Record<string, number> };

/** Replaces a category's image (800 px WebP) and deletes the previous object. */
export async function setCategoryImage(
  storeId: string,
  categoryId: string,
  data: Buffer,
  storage: StorageProvider = getStorageProvider(),
): Promise<CategoryImageResult> {
  const exists = await withStore(storeId, (tx) =>
    tx.category.findFirst({ where: { id: categoryId, storeId, deletedAt: null }, select: { id: true } }),
  );
  if (!exists) return { ok: false, error: "NOT_FOUND" };
  let image: StoredImage;
  try {
    image = (await processAndStoreImage("category", { storeId, data, storage })).variants.image;
  } catch (error) {
    if (error instanceof ImageUploadError) return { ok: false, error: error.code, values: error.values };
    throw error;
  }
  try {
    assertStoreKey(storeId, image.key, "category");
    const old = await withStore(storeId, async (tx) => {
      const current = await tx.category.findFirst({ where: { id: categoryId, storeId, deletedAt: null } });
      if (!current) return undefined;
      await tx.category.update({
        where: { id: categoryId },
        data: { imageKey: image.key, imageUrl: image.url },
      });
      return current.imageKey;
    });
    if (old === undefined) {
      await storage.delete(image.key);
      return { ok: false, error: "NOT_FOUND" };
    }
    if (old) await storage.delete(old).catch(() => {});
    return { ok: true, url: image.url };
  } catch (error) {
    await storage.delete(image.key).catch(() => {});
    throw error;
  }
}

/** Removes a category's image. */
export async function removeCategoryImage(
  storeId: string,
  categoryId: string,
  storage: StorageProvider = getStorageProvider(),
): Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" }> {
  const old = await withStore(storeId, async (tx) => {
    const current = await tx.category.findFirst({ where: { id: categoryId, storeId, deletedAt: null } });
    if (!current) return undefined;
    await tx.category.update({ where: { id: categoryId }, data: { imageKey: null, imageUrl: null } });
    return current.imageKey;
  });
  if (old === undefined) return { ok: false, error: "NOT_FOUND" };
  if (old) await storage.delete(old).catch(() => {});
  return { ok: true };
}
