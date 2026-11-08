import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createId } from "@paralleldrive/cuid2";
import { disconnectAll, forStore } from "@repo/db";
import { adminClient } from "@repo/db/admin";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bulkUpdateProducts,
  createCategory,
  createProduct,
  deleteCategory,
  duplicateProduct,
  getProductForEdit,
  listCategoryTree,
  moveCategory,
  permanentlyDeleteProducts,
  productInputSchema,
  categoryInputSchema,
  reorderFeatured,
  restoreProducts,
  setVariantStock,
  softDeleteProducts,
  updateCategory,
  updateProduct,
  MAX_FEATURED,
} from "../src/catalog";
import { LocalDiskProvider } from "../src/storage";
import { createTestStore, deleteStores } from "./helpers";

let a: { id: string };
let b: { id: string };
let dir: string;
let disk: LocalDiskProvider;

beforeAll(async () => {
  a = await createTestStore("cat-svc-a");
  b = await createTestStore("cat-svc-b");
  dir = await mkdtemp(path.join(tmpdir(), "ec-catalog-"));
  disk = new LocalDiskProvider({ root: dir });
});

afterAll(async () => {
  await deleteStores(a.id, b.id);
  await rm(dir, { recursive: true, force: true });
  await disconnectAll();
});

const parse = (input: Record<string, unknown>) => productInputSchema.parse({ defaultPrice: "500", ...input });
const cat = (input: Record<string, unknown>) => categoryInputSchema.parse(input);

const tee = (extra: Record<string, unknown> = {}) =>
  parse({
    titleBn: "টি-শার্ট",
    titleEn: "Tee Shirt",
    options: [
      {
        key: "size",
        values: [
          { id: "s", en: "S" },
          { id: "m", en: "M" },
          { id: "l", en: "L" },
        ],
      },
      {
        key: "colour",
        values: [
          { id: "red", bn: "লাল", en: "Red", hex: "#dc2626" },
          { id: "blue", bn: "নীল", en: "Blue" },
        ],
      },
    ],
    ...extra,
  });

async function ok<T extends { ok: boolean }>(p: Promise<T>): Promise<Extract<T, { ok: true }>> {
  const r = await p;
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}

describe("categories", () => {
  it("creates bilingual categories with unique slugs, two levels at most", async () => {
    const top = await ok(createCategory(a.id, cat({ nameBn: "পোশাক", nameEn: "Clothing" })));
    expect(top.slug).toBe("clothing");
    const again = await ok(createCategory(a.id, cat({ nameEn: "Clothing" })));
    expect(again.slug).toBe("clothing-2");
    const bnOnly = await ok(createCategory(a.id, cat({ nameBn: "শাড়ি" })));
    expect(bnOnly.slug).toBe("shari");

    const child = await ok(createCategory(a.id, cat({ nameEn: "Panjabi", parentId: top.id })));
    expect(await createCategory(a.id, cat({ nameEn: "Deep", parentId: child.id }))).toEqual({
      ok: false,
      error: "CATEGORY_DEPTH",
    });
    // A parent can't become a child.
    expect(await updateCategory(a.id, top.id, cat({ nameEn: "Clothing", parentId: bnOnly.id }))).toEqual({
      ok: false,
      error: "CATEGORY_DEPTH",
    });
    // Another store's category is not a valid parent.
    const theirs = await ok(createCategory(b.id, cat({ nameEn: "Theirs" })));
    expect(await createCategory(a.id, cat({ nameEn: "X", parentId: theirs.id }))).toEqual({
      ok: false,
      error: "PARENT_NOT_FOUND",
    });

    const tree = await listCategoryTree(a.id);
    const clothing = tree.find((t) => t.id === top.id)!;
    expect(clothing.children.map((c) => c.slug)).toEqual(["panjabi"]);
  });

  it("reorders siblings with up/down", async () => {
    const s = await createTestStore("cat-order");
    try {
      const ids = [];
      for (const n of ["One", "Two", "Three"])
        ids.push((await ok(createCategory(s.id, cat({ nameEn: n })))).id);
      await moveCategory(s.id, ids[2]!, "up");
      expect((await listCategoryTree(s.id)).map((c) => c.nameEn)).toEqual(["One", "Three", "Two"]);
      await moveCategory(s.id, ids[0]!, "up"); // already first: no change
      expect((await listCategoryTree(s.id)).map((c) => c.nameEn)).toEqual(["One", "Three", "Two"]);
    } finally {
      await deleteStores(s.id);
    }
  });

  it("deleting a category with products asks first, then uncategorises them and promotes children", async () => {
    const parent = await ok(createCategory(a.id, cat({ nameEn: "Seasonal" })));
    const child = await ok(createCategory(a.id, cat({ nameEn: "Winter", parentId: parent.id })));
    const p = await ok(createProduct(a.id, parse({ titleEn: "Scarf", categoryId: parent.id })));
    const imageKey = `stores/${a.id}/category/${createId()}.webp`;
    await disk.put(imageKey, Buffer.from("img"));
    await adminClient().category.update({
      where: { id: parent.id },
      data: { imageKey, imageUrl: disk.publicUrl(imageKey) },
    });

    expect(await deleteCategory(a.id, parent.id, { storage: disk })).toEqual({
      ok: false,
      error: "CATEGORY_HAS_PRODUCTS",
      productCount: 1,
    });
    expect(await deleteCategory(a.id, parent.id, { confirm: true, storage: disk })).toEqual({
      ok: true,
      uncategorised: 1,
      promoted: 1,
    });
    expect((await forStore(a.id).product.findUnique({ where: { id: p.id } }))?.categoryId).toBeNull();
    expect((await forStore(a.id).category.findUnique({ where: { id: child.id } }))?.parentId).toBeNull();
    expect(await disk.read(imageKey)).toBeNull();
  });
});

describe("products and the variant matrix", () => {
  it("creates 6 variants for size × colour with suggested SKUs and the default price", async () => {
    const r = await ok(createProduct(a.id, tee({ slug: "tee-matrix" })));
    const p = await getProductForEdit(a.id, r.id);
    expect(p!.variants.map((v) => v.sku).sort()).toEqual(
      [
        "TEE-MATRIX-S-RED",
        "TEE-MATRIX-S-BLUE",
        "TEE-MATRIX-M-RED",
        "TEE-MATRIX-M-BLUE",
        "TEE-MATRIX-L-RED",
        "TEE-MATRIX-L-BLUE",
      ].sort(),
    );
    expect(new Set(p!.variants.map((v) => v.price))).toEqual(new Set([50000]));
  });

  it("a simple product gets one default variant", async () => {
    const r = await ok(createProduct(a.id, parse({ titleEn: "Plain Mug", variants: [{ stock: "4" }] })));
    const p = await getProductForEdit(a.id, r.id);
    expect(p!.variants).toMatchObject([{ optionKey: "|", sku: "PLAIN-MUG", stock: 4, price: 50000 }]);
  });

  it("editing axes keeps matching variants (stock, SKU, price) and soft-deletes removed ones", async () => {
    const r = await ok(createProduct(a.id, tee({ slug: "tee-edit" })));
    let p = (await getProductForEdit(a.id, r.id))!;
    const sm = p.variants.find((v) => v.optionKey === "s|red")!;
    await ok(
      updateProduct(
        a.id,
        r.id,
        tee({
          slug: "tee-edit",
          variants: [
            {
              optionValues: { size: "s", colour: "red" },
              stock: "11",
              sku: "MY-SKU",
              price: "700",
              salePrice: "650",
            },
          ],
        }),
      ),
    );
    // Remove L, add XL.
    const edited = tee({ slug: "tee-edit", defaultPrice: "800" });
    edited.options[0]!.values = [
      { id: "s", bn: "S", en: "S" },
      { id: "m", bn: "M", en: "M" },
      { id: "xl", bn: "XL", en: "XL" },
    ];
    await ok(updateProduct(a.id, r.id, edited));
    p = (await getProductForEdit(a.id, r.id))!;
    const keys = p.variants.map((v) => v.optionKey).sort();
    expect(keys).toEqual(["m|blue", "m|red", "s|blue", "s|red", "xl|blue", "xl|red"]);
    const kept = p.variants.find((v) => v.optionKey === "s|red")!;
    expect(kept).toMatchObject({ id: sm.id, sku: "MY-SKU", stock: 11, price: 70000, salePrice: 65000 });
    expect(p.variants.find((v) => v.optionKey === "xl|red")).toMatchObject({
      price: 80000,
      stock: 0,
      sku: "TEE-EDIT-XL-RED",
    });
    const deleted = await adminClient().variant.findMany({
      where: { productId: r.id, deletedAt: { not: null } },
    });
    expect(deleted.map((v) => v.optionKey).sort()).toEqual(["l|blue", "l|red"]);
  });

  it("rejects a sale price at or above the price (also for a kept variant's existing price)", async () => {
    const r = await ok(
      createProduct(a.id, parse({ titleEn: "Sale Test", variants: [{ price: "100", salePrice: "80" }] })),
    );
    // Lowering the price below the existing sale price is refused.
    expect(
      await updateProduct(a.id, r.id, parse({ titleEn: "Sale Test", variants: [{ price: "70" }] })),
    ).toMatchObject({
      ok: false,
      error: "SALE_PRICE_TOO_HIGH",
    });
  });

  it("SKUs are unique per store; another store may reuse them", async () => {
    await ok(createProduct(a.id, parse({ titleEn: "Sku One", variants: [{ sku: "DUP-1" }] })));
    expect(
      await createProduct(a.id, parse({ titleEn: "Sku Two", variants: [{ sku: "dup-1" }] })),
    ).toMatchObject({
      ok: false,
      error: "SKU_TAKEN",
    });
    await ok(createProduct(b.id, parse({ titleEn: "Sku One", variants: [{ sku: "DUP-1" }] })));
  });

  it("can't use another store's category", async () => {
    const theirs = await ok(createCategory(b.id, cat({ nameEn: "B only" })));
    expect(await createProduct(a.id, parse({ titleEn: "Cross", categoryId: theirs.id }))).toEqual({
      ok: false,
      error: "CATEGORY_NOT_FOUND",
    });
  });

  it("another store can't read or update the product", async () => {
    const r = await ok(createProduct(a.id, parse({ titleEn: "Private" })));
    expect(await getProductForEdit(b.id, r.id)).toBeNull();
    expect(await updateProduct(b.id, r.id, parse({ titleEn: "Hacked" }))).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    const v = (await getProductForEdit(a.id, r.id))!.variants[0]!;
    expect(
      await setVariantStock(b.id, { variantId: v.id, stock: 1, expectedUpdatedAt: v.updatedAt }),
    ).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });
});

describe("stock edits", () => {
  it("a stale edit returns STALE_UPDATE instead of overwriting", async () => {
    const r = await ok(createProduct(a.id, parse({ titleEn: "Stocked", variants: [{ stock: "10" }] })));
    const v = (await getProductForEdit(a.id, r.id))!.variants[0]!;
    // Two editors loaded the same variant.
    const [first, second] = await Promise.all([
      setVariantStock(a.id, { variantId: v.id, stock: 7, expectedUpdatedAt: v.updatedAt }),
      setVariantStock(a.id, { variantId: v.id, stock: 3, expectedUpdatedAt: v.updatedAt }),
    ]);
    const results = [first, second];
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    const stale = results.find((x) => !x.ok)!;
    const winner = results.find((x) => x.ok)! as { stock: number };
    expect(stale).toMatchObject({ ok: false, error: "STALE_UPDATE", current: { stock: winner.stock } });
  });
});

describe("bulk actions and featured", () => {
  it("publish, unpublish, archive, move and delete several products", async () => {
    const s = await createTestStore("bulk");
    try {
      const ids = [];
      for (const n of ["A", "B", "C"])
        ids.push((await ok(createProduct(s.id, parse({ titleEn: `Bulk ${n}` })))).id);
      const c = await ok(createCategory(s.id, cat({ nameEn: "Target" })));
      expect(await bulkUpdateProducts(s.id, { ids, action: "publish" })).toEqual({ ok: true, count: 3 });
      expect(await bulkUpdateProducts(s.id, { ids: [ids[0]!], action: "archive" })).toEqual({
        ok: true,
        count: 1,
      });
      expect(await bulkUpdateProducts(s.id, { ids: [ids[1]!], action: "unpublish" })).toEqual({
        ok: true,
        count: 1,
      });
      expect(await bulkUpdateProducts(s.id, { ids, action: "move", categoryId: c.id })).toEqual({
        ok: true,
        count: 3,
      });
      const rows = await forStore(s.id).product.findMany({ orderBy: { titleEn: "asc" } });
      expect(rows.map((r) => [r.status, r.categoryId])).toEqual([
        ["ARCHIVED", c.id],
        ["DRAFT", c.id],
        ["ACTIVE", c.id],
      ]);
      expect(await bulkUpdateProducts(s.id, { ids, action: "delete" })).toEqual({ ok: true, count: 3 });
      expect(await forStore(s.id).product.count({ where: { deletedAt: null } })).toBe(0);
      // Another store's ids are ignored.
      expect(await bulkUpdateProducts(b.id, { ids, action: "publish" })).toEqual({ ok: true, count: 0 });
    } finally {
      await deleteStores(s.id);
    }
  });

  it(`allows at most ${MAX_FEATURED} featured products and reorders them`, async () => {
    const s = await createTestStore("featured");
    try {
      const ids: string[] = [];
      for (let i = 0; i < MAX_FEATURED + 1; i++) {
        ids.push((await ok(createProduct(s.id, parse({ titleEn: `Feat ${i}` })))).id);
      }
      expect(await bulkUpdateProducts(s.id, { ids: ids.slice(0, MAX_FEATURED), action: "feature" })).toEqual({
        ok: true,
        count: MAX_FEATURED,
      });
      expect(await bulkUpdateProducts(s.id, { ids: [ids[MAX_FEATURED]!], action: "feature" })).toEqual({
        ok: false,
        error: "FEATURED_LIMIT",
      });
      expect(await createProduct(s.id, parse({ titleEn: "One more", isFeatured: "on" }))).toEqual({
        ok: false,
        error: "FEATURED_LIMIT",
      });
      const reversed = ids.slice(0, MAX_FEATURED).reverse();
      await ok(reorderFeatured(s.id, reversed));
      const featured = await forStore(s.id).product.findMany({
        where: { isFeatured: true },
        orderBy: { featuredOrder: "asc" },
        select: { id: true },
      });
      expect(featured.map((f) => f.id)).toEqual(reversed);
      // Trashing a featured product frees a slot.
      await softDeleteProducts(s.id, [ids[0]!]);
      await ok(bulkUpdateProducts(s.id, { ids: [ids[MAX_FEATURED]!], action: "feature" }));
      expect(await reorderFeatured(s.id, [ids[0]!])).toEqual({ ok: false, error: "NOT_FOUND" });
    } finally {
      await deleteStores(s.id);
    }
  });
});

describe("duplicate, trash, restore and permanent delete", () => {
  async function productWithImages(storeId: string) {
    const r = await ok(
      createProduct(
        storeId,
        tee({
          slug: `dup-${createId().slice(0, 5)}`,
          variants: [{ optionValues: { size: "s", colour: "red" }, stock: "5" }],
        }),
      ),
    );
    const keys: string[] = [];
    for (let i = 0; i < 2; i++) {
      const id = createId();
      const key = `stores/${storeId}/product/${id}.webp`;
      const thumbKey = `stores/${storeId}/product/thumb/${id}.webp`;
      await disk.put(key, Buffer.from(`img${i}`));
      await disk.put(thumbKey, Buffer.from(`thumb${i}`));
      keys.push(key, thumbKey);
      const img = await forStore(storeId).productImage.create({
        data: {
          storeId,
          productId: r.id,
          key,
          thumbKey,
          url: disk.publicUrl(key),
          thumbUrl: disk.publicUrl(thumbKey),
          width: 10,
          height: 10,
          sortOrder: i,
        },
      });
      if (i === 1)
        await forStore(storeId).variant.updateMany({
          where: { productId: r.id, optionKey: "s|red" },
          data: { imageId: img.id },
        });
    }
    return { id: r.id, keys };
  }

  it("duplicates as a DRAFT with new SKUs, stock 0 and copied image objects", async () => {
    const src = await productWithImages(a.id);
    const copy = await ok(duplicateProduct(a.id, src.id, disk));
    const p = (await getProductForEdit(a.id, copy.id))!;
    const orig = (await getProductForEdit(a.id, src.id))!;
    expect(p.status).toBe("DRAFT");
    expect(p.titleEn).toMatch(/\(copy\)$/);
    expect(p.variants).toHaveLength(6);
    expect(p.variants.every((v) => v.stock === 0 && v.sku.endsWith("-COPY"))).toBe(true);
    const copiedKeys = p.images.flatMap((i) => [i.key, i.thumbKey]);
    expect(copiedKeys.some((k) => src.keys.includes(k))).toBe(false);
    for (const k of copiedKeys) expect(await disk.read(k)).not.toBeNull();
    // The red variant points at the copy of its image, not the original.
    const redCopy = p.variants.find((v) => v.optionKey === "s|red")!;
    expect(p.images.map((i) => i.id)).toContain(redCopy.imageId);
    expect(orig.images.map((i) => i.id)).not.toContain(redCopy.imageId);
  });

  it("trash → restore, and permanent delete removes rows and image objects", async () => {
    const src = await productWithImages(a.id);
    const slug = (await getProductForEdit(a.id, src.id))!.slug;
    expect(await softDeleteProducts(a.id, [src.id])).toEqual({ ok: true, count: 1 });
    expect(await getProductForEdit(a.id, src.id)).toBeNull();
    // Not in the trash → permanent delete ignores it; in the trash → restore works.
    await ok(restoreProducts(a.id, [src.id]));
    expect((await getProductForEdit(a.id, src.id))?.slug).toBe(slug);
    expect(await permanentlyDeleteProducts(a.id, [src.id], disk)).toMatchObject({ count: 0 });

    // A slug taken while in the trash gets a suffix on restore.
    await softDeleteProducts(a.id, [src.id]);
    const squatter = await ok(createProduct(a.id, parse({ titleEn: "Squatter", slug })));
    expect(squatter.slug).toBe(slug);
    await restoreProducts(a.id, [src.id]);
    expect((await getProductForEdit(a.id, src.id))?.slug).toBe(`${slug}-2`);

    await softDeleteProducts(a.id, [src.id]);
    // Another store can't delete it.
    expect(await permanentlyDeleteProducts(b.id, [src.id], disk)).toMatchObject({ count: 0 });
    const res = await permanentlyDeleteProducts(a.id, [src.id], disk);
    expect(res).toMatchObject({ ok: true, count: 1, deletedObjects: 4, failedObjects: [] });
    for (const k of src.keys) expect(await disk.read(k)).toBeNull();
    expect(await adminClient().product.findUnique({ where: { id: src.id } })).toBeNull();
    expect(await adminClient().variant.count({ where: { productId: src.id } })).toBe(0);
  });
});
