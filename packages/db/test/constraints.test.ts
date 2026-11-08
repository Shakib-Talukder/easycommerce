import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll } from "../src/client";
import { forStore } from "../src/tenant";
import { createTestStore, deleteStores } from "./helpers";

let store: { id: string };
const titles = (t: string) => ({ titleBn: t, titleEn: t });
let db: ReturnType<typeof forStore>;

beforeAll(async () => {
  store = await createTestStore("c");
  db = forStore(store.id);
});

afterAll(async () => {
  await deleteStores(store.id);
  await disconnectAll();
});

describe("CHECK constraints", () => {
  it("rejects a user with neither email nor phone", async () => {
    await expect(db.user.create({ data: { storeId: store.id, name: "Nobody" } })).rejects.toThrow(
      /users_email_or_phone_chk/,
    );
  });

  it("rejects a non-E.164 phone", async () => {
    await expect(
      db.user.create({ data: { storeId: store.id, name: "Bad", phone: "01711000000" } }),
    ).rejects.toThrow(/users_phone_e164_chk/);
  });

  it("rejects negative prices and stock", async () => {
    const p = await db.product.create({ data: { storeId: store.id, ...titles("ok"), slug: "ok" } });
    await expect(
      db.variant.create({
        data: { storeId: store.id, productId: p.id, sku: "NEG-STOCK", price: 100, stock: -1 },
      }),
    ).rejects.toThrow(/variants_stock_chk/);
    await expect(
      db.variant.create({
        data: {
          storeId: store.id,
          productId: p.id,
          sku: "NEG-PRICE",
          price: -5,
          optionValues: { size: "s" },
          optionKey: "s|",
        },
      }),
    ).rejects.toThrow(/variants_price_chk/);
  });

  it("rejects an invalid subdomain at the database level", async () => {
    const { adminClient } = await import("../src/admin");
    await expect(
      adminClient().store.create({ data: { nameBn: "Bad", nameEn: "Bad", subdomain: "Bad_Name" } }),
    ).rejects.toThrow(/stores_subdomain_format_chk/);
  });
});

describe("uniqueness", () => {
  it("emails are case-insensitive per store (citext)", async () => {
    await db.user.create({ data: { storeId: store.id, name: "One", email: "Owner@Shop.test" } });
    await expect(
      db.user.create({ data: { storeId: store.id, name: "Two", email: "owner@shop.test" } }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it("product slugs are unique only among non-deleted rows", async () => {
    const first = await db.product.create({
      data: { storeId: store.id, ...titles("First"), slug: "reusable" },
    });
    await expect(
      db.product.create({ data: { storeId: store.id, ...titles("Dup"), slug: "reusable" } }),
    ).rejects.toThrow(/Unique constraint/i);

    await db.product.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    const second = await db.product.create({
      data: { storeId: store.id, ...titles("Second"), slug: "reusable" },
    });
    expect(second.slug).toBe("reusable");
  });

  it("SKUs are unique only among non-deleted variants", async () => {
    const p = await db.product.create({ data: { storeId: store.id, ...titles("V"), slug: "v" } });
    const v = await db.variant.create({
      data: { storeId: store.id, productId: p.id, sku: "SKU-1", price: 1 },
    });
    await expect(
      db.variant.create({
        data: {
          storeId: store.id,
          productId: p.id,
          sku: "SKU-1",
          price: 1,
          optionValues: { size: "b" },
          optionKey: "b|",
        },
      }),
    ).rejects.toThrow(/Unique constraint/i);
    await db.variant.update({ where: { id: v.id }, data: { deletedAt: new Date() } });
    await expect(
      db.variant.create({
        data: {
          storeId: store.id,
          productId: p.id,
          sku: "SKU-1",
          price: 1,
          optionValues: { size: "c" },
          optionKey: "c|",
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("the same slug is allowed in different stores", async () => {
    const other = await createTestStore("c2");
    try {
      await db.category.create({
        data: { storeId: store.id, nameBn: "জুতা", nameEn: "Shoes", slug: "shoes" },
      });
      await expect(
        forStore(other.id).category.create({
          data: { storeId: other.id, nameBn: "জুতা", nameEn: "Shoes", slug: "shoes" },
        }),
      ).resolves.toBeTruthy();
    } finally {
      await deleteStores(other.id);
    }
  });
});

describe("Bangla text", () => {
  it("round-trips UTF-8 Bangla unchanged", async () => {
    const title = "জামদানি শাড়ি — ঈদ সংগ্রহ ২০২৬";
    const created = await db.product.create({
      data: {
        storeId: store.id,
        titleBn: title,
        titleEn: "Jamdani",
        slug: "bangla",
        descriptionBn: "হাতে বোনা",
      },
    });
    const found = await db.product.findUnique({ where: { id: created.id } });
    expect(found?.titleBn).toBe(title);
    expect(found?.descriptionBn).toBe("হাতে বোনা");
  });
});
