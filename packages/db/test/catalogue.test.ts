import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient } from "../src/admin";
import { disconnectAll } from "../src/client";
import { forStore, withStore } from "../src/tenant";
import { createTestStore, deleteStores, rawAppConnection } from "./helpers";

/*
 * Day 3 catalogue schema: CHECKs, the unique option combination, the cross-row
 * triggers (category depth, same-store references, variant image of the same
 * product) and RLS isolation for categories, products, variants and product_images.
 */

let a: { id: string };
let b: { id: string };

const titles = (t: string) => ({ titleBn: `${t} বাংলা`, titleEn: t });
const imageKeys = (storeId: string) => {
  const id = createId();
  return {
    key: `stores/${storeId}/product/${id}.webp`,
    thumbKey: `stores/${storeId}/product/thumb/${id}.webp`,
    url: `/api/uploads/stores/${storeId}/product/${id}.webp`,
    thumbUrl: `/api/uploads/stores/${storeId}/product/thumb/${id}.webp`,
    width: 1600,
    height: 1200,
  };
};

async function product(storeId: string, slug = `p-${createId().slice(0, 6)}`) {
  return forStore(storeId).product.create({ data: { storeId, ...titles(slug), slug } });
}

beforeAll(async () => {
  a = await createTestStore("cat-a");
  b = await createTestStore("cat-b");
});

afterAll(async () => {
  await deleteStores(a.id, b.id);
  await disconnectAll();
});

describe("variants", () => {
  it("sale price must be below the regular price", async () => {
    const p = await product(a.id);
    const db = forStore(a.id);
    await expect(
      db.variant.create({
        data: { storeId: a.id, productId: p.id, sku: "S1", price: 1000, salePrice: 1000 },
      }),
    ).rejects.toThrow(/variants_sale_price_chk/);
    await expect(
      db.variant.create({ data: { storeId: a.id, productId: p.id, sku: "S2", price: 1000, salePrice: 999 } }),
    ).resolves.toMatchObject({ salePrice: 999 });
  });

  it("option values only use size/colour, and option_key must match them", async () => {
    const p = await product(a.id);
    const db = forStore(a.id);
    await expect(
      db.variant.create({
        data: {
          storeId: a.id,
          productId: p.id,
          sku: "O1",
          price: 1,
          optionValues: { weight: "5kg" },
          optionKey: "|",
        },
      }),
    ).rejects.toThrow(/variants_option_values_chk/);
    await expect(
      db.variant.create({
        data: {
          storeId: a.id,
          productId: p.id,
          sku: "O2",
          price: 1,
          optionValues: { size: "m" },
          optionKey: "x|",
        },
      }),
    ).rejects.toThrow(/variants_option_key_chk/);
  });

  it("allows one variant per option combination among non-deleted rows", async () => {
    const p = await product(a.id);
    const db = forStore(a.id);
    const combo = { optionValues: { size: "m", colour: "red" }, optionKey: "m|red" };
    const first = await db.variant.create({
      data: { storeId: a.id, productId: p.id, sku: "C1", price: 1, ...combo },
    });
    await expect(
      db.variant.create({ data: { storeId: a.id, productId: p.id, sku: "C2", price: 1, ...combo } }),
    ).rejects.toThrow(/Unique constraint/i);
    await db.variant.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    await expect(
      db.variant.create({ data: { storeId: a.id, productId: p.id, sku: "C3", price: 1, ...combo } }),
    ).resolves.toBeTruthy();
  });

  it("image_id must be an image of the same product", async () => {
    const p1 = await product(a.id);
    const p2 = await product(a.id);
    const db = forStore(a.id);
    const img = await db.productImage.create({
      data: { storeId: a.id, productId: p2.id, ...imageKeys(a.id) },
    });
    await expect(
      db.variant.create({ data: { storeId: a.id, productId: p1.id, sku: "I1", price: 1, imageId: img.id } }),
    ).rejects.toThrow(/IMAGE_NOT_FOUND/);
    const own = await db.productImage.create({
      data: { storeId: a.id, productId: p1.id, ...imageKeys(a.id) },
    });
    const v = await db.variant.create({
      data: { storeId: a.id, productId: p1.id, sku: "I2", price: 1, imageId: own.id },
    });
    // Deleting the image clears the link instead of failing.
    await db.productImage.delete({ where: { id: own.id } });
    expect((await db.variant.findUnique({ where: { id: v.id } }))?.imageId).toBeNull();
  });
});

describe("products", () => {
  it("validates titles, slug, description length, options shape and featured order", async () => {
    const db = forStore(a.id);
    const base = { storeId: a.id, ...titles("x") };
    await expect(db.product.create({ data: { ...base, titleEn: " ", slug: "t1" } })).rejects.toThrow(
      /products_title_en_chk/,
    );
    await expect(db.product.create({ data: { ...base, slug: "Bad Slug" } })).rejects.toThrow(
      /products_slug_chk/,
    );
    await expect(
      db.product.create({ data: { ...base, slug: "t2", descriptionBn: "অ".repeat(5001) } }),
    ).rejects.toThrow(/products_description_chk/);
    await expect(
      db.product.create({
        data: { ...base, slug: "t3", options: [{ key: "size" }, { key: "colour" }, { key: "x" }] },
      }),
    ).rejects.toThrow(/products_options_chk/);
    await expect(db.product.create({ data: { ...base, slug: "t4", featuredOrder: 1 } })).rejects.toThrow(
      /products_featured_order_chk/,
    );
    await expect(
      db.product.create({ data: { ...base, slug: "t5", isFeatured: true, featuredOrder: 0 } }),
    ).resolves.toBeTruthy();
  });

  it("can't use another store's category", async () => {
    const theirs = await forStore(b.id).category.create({
      data: { storeId: b.id, nameBn: "ওদের", nameEn: "Theirs", slug: "theirs" },
    });
    await expect(
      forStore(a.id).product.create({
        data: { storeId: a.id, ...titles("x"), slug: "cross", categoryId: theirs.id },
      }),
    ).rejects.toThrow(/CATEGORY_NOT_FOUND/);
    // Even the BYPASSRLS role can't link across stores.
    const mine = await product(a.id);
    await expect(
      adminClient().product.update({ where: { id: mine.id }, data: { categoryId: theirs.id } }),
    ).rejects.toThrow(/CATEGORY_NOT_FOUND/);
  });
});

describe("categories", () => {
  it("allow at most two levels and only same-store parents", async () => {
    const db = forStore(a.id);
    const cat = (slug: string, parentId?: string) =>
      db.category.create({ data: { storeId: a.id, nameBn: slug, nameEn: slug, slug, parentId } });
    const top = await cat("top");
    const child = await cat("child", top.id);
    await expect(cat("grandchild", child.id)).rejects.toThrow(/CATEGORY_DEPTH/);
    // A category that has children can't itself become a child.
    const other = await cat("other");
    await expect(db.category.update({ where: { id: top.id }, data: { parentId: other.id } })).rejects.toThrow(
      /CATEGORY_DEPTH/,
    );
    await expect(
      db.category.update({ where: { id: other.id }, data: { parentId: other.id } }),
    ).rejects.toThrow(/categories_parent_not_self_chk/);
    const foreign = await forStore(b.id).category.create({
      data: { storeId: b.id, nameBn: "ফ", nameEn: "F", slug: "foreign-parent" },
    });
    await expect(cat("adopted", foreign.id)).rejects.toThrow(/CATEGORY_PARENT_INVALID/);
  });

  it("only accepts image keys under the store's category prefix", async () => {
    await expect(
      forStore(a.id).category.create({
        data: {
          storeId: a.id,
          nameBn: "ছ",
          nameEn: "Img",
          slug: "img",
          imageKey: `stores/${b.id}/category/x.webp`,
        },
      }),
    ).rejects.toThrow(/categories_image_key_chk/);
  });

  it("slugs are unique per store among non-deleted rows", async () => {
    const db = forStore(a.id);
    const first = await db.category.create({
      data: { storeId: a.id, nameBn: "জ", nameEn: "Shoes", slug: "shoes" },
    });
    await expect(
      db.category.create({ data: { storeId: a.id, nameBn: "জ", nameEn: "Shoes", slug: "shoes" } }),
    ).rejects.toThrow(/Unique constraint/i);
    await db.category.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    await expect(
      db.category.create({ data: { storeId: a.id, nameBn: "জ", nameEn: "Shoes", slug: "shoes" } }),
    ).resolves.toBeTruthy();
  });
});

describe("product_images", () => {
  it("keys must be under stores/<store_id>/product/", async () => {
    const p = await product(a.id);
    const db = forStore(a.id);
    const keys = imageKeys(a.id);
    await expect(
      db.productImage.create({
        data: { storeId: a.id, productId: p.id, ...keys, key: `stores/${b.id}/product/x.webp` },
      }),
    ).rejects.toThrow(/product_images_key_chk/);
    await expect(
      db.productImage.create({
        data: { storeId: a.id, productId: p.id, ...keys, thumbKey: `stores/${a.id}/logo/x.webp` },
      }),
    ).rejects.toThrow(/product_images_key_chk/);
  });

  it("can't attach an image to another store's product (even by id)", async () => {
    const theirs = await product(b.id);
    await expect(
      forStore(a.id).productImage.create({
        data: { storeId: a.id, productId: theirs.id, ...imageKeys(a.id) },
      }),
    ).rejects.toThrow(/PRODUCT_NOT_FOUND/);
  });
});

describe("row-level security on the catalogue", () => {
  it("each store sees and changes only its own categories, products, variants and images", async () => {
    const pb = await product(b.id, "rls-b");
    await withStore(b.id, async (tx) => {
      await tx.category.create({ data: { storeId: b.id, nameBn: "খ", nameEn: "B cat", slug: "b-cat" } });
      await tx.variant.create({ data: { storeId: b.id, productId: pb.id, sku: "B-1", price: 100 } });
      await tx.productImage.create({ data: { storeId: b.id, productId: pb.id, ...imageKeys(b.id) } });
    });
    const dbA = forStore(a.id);
    const [cat, prod, vari, img] = await Promise.all([
      dbA.category.findMany({ where: { storeId: b.id } }),
      dbA.product.findMany({ where: { storeId: b.id } }),
      dbA.variant.findMany({ where: { storeId: b.id } }),
      dbA.productImage.findMany({ where: { storeId: b.id } }),
    ]);
    expect([cat, prod, vari, img].map((r) => r.length)).toEqual([0, 0, 0, 0]);
    expect(await dbA.product.findUnique({ where: { id: pb.id } })).toBeNull();

    const changed = await Promise.all([
      dbA.variant.updateMany({ where: { productId: pb.id }, data: { stock: 999 } }),
      dbA.productImage.deleteMany({ where: { productId: pb.id } }),
      dbA.category.updateMany({ where: { storeId: b.id }, data: { nameEn: "hacked" } }),
      dbA.product.updateMany({ where: { id: pb.id }, data: { status: "ARCHIVED" } }),
    ]);
    expect(changed.map((c) => c.count)).toEqual([0, 0, 0, 0]);

    await expect(
      dbA.variant.create({ data: { storeId: b.id, productId: pb.id, sku: "SNEAK", price: 1 } }),
      // The guard trigger runs first and can't see store B's product; RLS would reject it anyway.
    ).rejects.toThrow(/row-level security|PRODUCT_NOT_FOUND/i);
    await expect(
      dbA.productImage.create({ data: { storeId: b.id, productId: pb.id, ...imageKeys(b.id) } }),
    ).rejects.toThrow(/row-level security|PRODUCT_NOT_FOUND/i);
  });

  it("product_images has RLS enabled with the tenant_isolation policy", async () => {
    const conn = await rawAppConnection();
    try {
      const { rows } = await conn.query<{ relrowsecurity: boolean; policies: string[] }>(
        `SELECT c.relrowsecurity, array_agg(p.polname)::text[] AS policies
           FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
          WHERE c.relname = 'product_images' GROUP BY c.relrowsecurity`,
      );
      expect(rows[0]).toEqual({ relrowsecurity: true, policies: ["tenant_isolation"] });
    } finally {
      await conn.end();
    }
  });
});
