import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { disconnectAll, forStore } from "@repo/db";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addProductImage,
  categoryInputSchema,
  createCategory,
  createProduct,
  deleteProductImage,
  getProductForEdit,
  linkImageToColour,
  listProductImages,
  productInputSchema,
  removeCategoryImage,
  reorderProductImages,
  setCategoryImage,
  setCoverImage,
  updateImageAlt,
} from "../src/catalog";
import { LocalDiskProvider } from "../src/storage";
import { createTestStore, deleteStores } from "./helpers";

let a: { id: string };
let b: { id: string };
let dir: string;
let disk: LocalDiskProvider;

const photo = (w: number, h: number, r = 200) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g: 60, b: 60 } } })
    .jpeg()
    .toBuffer();

beforeAll(async () => {
  a = await createTestStore("img-a");
  b = await createTestStore("img-b");
  dir = await mkdtemp(path.join(tmpdir(), "ec-catalog-img-"));
  disk = new LocalDiskProvider({ root: dir });
});

afterAll(async () => {
  await deleteStores(a.id, b.id);
  await rm(dir, { recursive: true, force: true });
  await disconnectAll();
});

async function product(storeId: string) {
  const r = await createProduct(
    storeId,
    productInputSchema.parse({
      titleEn: `Shirt ${Math.random().toString(36).slice(2, 6)}`,
      defaultPrice: "500",
      options: [
        {
          key: "size",
          values: [
            { id: "s", en: "S" },
            { id: "m", en: "M" },
          ],
        },
        {
          key: "colour",
          values: [
            { id: "red", en: "Red" },
            { id: "blue", en: "Blue" },
          ],
        },
      ],
    }),
  );
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

describe("product images", () => {
  it("stores 1600 px + 400 px WebP under stores/<id>/product/ and lists them in order", async () => {
    const id = await product(a.id);
    const r = await addProductImage(a.id, id, await photo(2400, 1800), disk);
    expect(r).toMatchObject({ ok: true, image: { width: 1600, height: 1200, sortOrder: 0 } });
    const second = await addProductImage(a.id, id, await photo(800, 800), disk);
    expect(second).toMatchObject({ ok: true, image: { sortOrder: 1 } });
    const row = (await forStore(a.id).productImage.findMany({ where: { productId: id } }))[0]!;
    expect(row.key).toMatch(new RegExp(`^stores/${a.id}/product/[a-z0-9]+\\.webp$`));
    expect(row.thumbKey).toMatch(new RegExp(`^stores/${a.id}/product/thumb/[a-z0-9]+\\.webp$`));
    expect((await sharp((await disk.read(row.thumbKey))!).metadata()).width).toBe(400);
  });

  it("rejects too-small photos, unknown/other-store products, and keeps the 10-photo limit under concurrency", async () => {
    const id = await product(a.id);
    expect(await addProductImage(a.id, id, await photo(299, 1000), disk)).toEqual({
      ok: false,
      error: "UPLOAD_TOO_SMALL",
      values: { min: 300 },
    });
    expect(await addProductImage(b.id, id, await photo(400, 400), disk)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    for (let i = 0; i < 8; i++) await addProductImage(a.id, id, await photo(320, 320, i * 20), disk);
    // 8 stored; three parallel uploads: exactly two fit.
    const results = await Promise.all(
      [0, 1, 2].map(async (i) => addProductImage(a.id, id, await photo(330 + i, 330), disk)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: "IMAGE_LIMIT" });
    expect(await listProductImages(a.id, id)).toHaveLength(10);
    // The refused upload's objects were removed: 10 photos × 2 objects for this product.
    const keys = [];
    for await (const o of disk.list(`stores/${a.id}/product/`)) keys.push(o.key);
    const rows = await forStore(a.id).productImage.findMany({ where: { storeId: a.id } });
    expect(keys.sort()).toEqual(rows.flatMap((r) => [r.key, r.thumbKey]).sort());
  });

  it("reorders, sets the cover, edits alt text and links a photo to a colour", async () => {
    const id = await product(a.id);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await addProductImage(a.id, id, await photo(400, 400, 50 * i), disk);
      if (r.ok) ids.push(r.image.id);
    }
    await reorderProductImages(a.id, id, [ids[2]!, ids[0]!, ids[1]!]);
    expect((await listProductImages(a.id, id)).map((i) => i.id)).toEqual([ids[2], ids[0], ids[1]]);
    await setCoverImage(a.id, id, ids[1]!);
    expect((await listProductImages(a.id, id))[0]!.id).toBe(ids[1]);
    expect(await reorderProductImages(b.id, id, ids)).toEqual({ ok: false, error: "NOT_FOUND" });

    expect(await updateImageAlt(a.id, ids[0]!, { altBn: "লাল শার্ট", altEn: "Red shirt" })).toEqual({
      ok: true,
    });
    expect(await updateImageAlt(b.id, ids[0]!, { altEn: "hacked" })).toEqual({
      ok: false,
      error: "IMAGE_NOT_FOUND",
    });

    expect(await linkImageToColour(a.id, id, "red", ids[0]!)).toEqual({ ok: true, count: 2 });
    const p = (await getProductForEdit(a.id, id))!;
    expect(
      p.variants
        .filter((v) => v.imageId === ids[0])
        .map((v) => v.optionKey)
        .sort(),
    ).toEqual(["m|red", "s|red"]);
    // Another product's photo can't be linked.
    const other = await product(a.id);
    const foreign = await addProductImage(a.id, other, await photo(400, 400), disk);
    if (!foreign.ok) throw new Error(foreign.error);
    expect(await linkImageToColour(a.id, id, "blue", foreign.image.id)).toEqual({
      ok: false,
      error: "IMAGE_NOT_FOUND",
    });

    // Deleting the linked photo clears the link and removes its objects.
    const row = await forStore(a.id).productImage.findUnique({ where: { id: ids[0]! } });
    expect(await deleteProductImage(a.id, ids[0]!, disk)).toEqual({ ok: true });
    expect(await disk.read(row!.key)).toBeNull();
    expect(await disk.read(row!.thumbKey)).toBeNull();
    expect((await getProductForEdit(a.id, id))!.variants.every((v) => v.imageId === null)).toBe(true);
    expect(await deleteProductImage(b.id, ids[1]!, disk)).toEqual({ ok: false, error: "IMAGE_NOT_FOUND" });
  });
});

describe("category images", () => {
  it("stores an 800 px image, replaces it (deleting the old object) and removes it", async () => {
    const c = await createCategory(a.id, categoryInputSchema.parse({ nameEn: "With Image" }));
    if (!c.ok) throw new Error(c.error);
    const first = await setCategoryImage(a.id, c.id, await photo(1600, 1000), disk);
    expect(first.ok).toBe(true);
    const row1 = await forStore(a.id).category.findUnique({ where: { id: c.id } });
    expect(row1!.imageKey).toMatch(new RegExp(`^stores/${a.id}/category/`));
    expect((await sharp((await disk.read(row1!.imageKey!))!).metadata()).width).toBe(800);
    await setCategoryImage(a.id, c.id, await photo(900, 900), disk);
    expect(await disk.read(row1!.imageKey!)).toBeNull();
    expect(await setCategoryImage(b.id, c.id, await photo(900, 900), disk)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    const row2 = await forStore(a.id).category.findUnique({ where: { id: c.id } });
    await removeCategoryImage(a.id, c.id, disk);
    expect(await disk.read(row2!.imageKey!)).toBeNull();
    expect((await forStore(a.id).category.findUnique({ where: { id: c.id } }))!.imageUrl).toBeNull();
  });
});
