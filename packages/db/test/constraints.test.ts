import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll } from "../src/client";
import { forStore } from "../src/tenant";
import { createTestStore, deleteStores } from "./helpers";

let store: { id: string };
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
    await expect(
      db.product.create({ data: { storeId: store.id, title: "x", slug: "neg", basePrice: -1 } }),
    ).rejects.toThrow(/products_base_price_chk/);

    const p = await db.product.create({ data: { storeId: store.id, title: "ok", slug: "ok", basePrice: 0 } });
    await expect(
      db.variant.create({
        data: { storeId: store.id, productId: p.id, sku: "NEG-STOCK", title: "x", price: 100, stock: -1 },
      }),
    ).rejects.toThrow(/variants_stock_chk/);
    await expect(
      db.variant.create({
        data: { storeId: store.id, productId: p.id, sku: "NEG-PRICE", title: "x", price: -5 },
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
      data: { storeId: store.id, title: "First", slug: "reusable", basePrice: 100 },
    });
    await expect(
      db.product.create({ data: { storeId: store.id, title: "Dup", slug: "reusable", basePrice: 100 } }),
    ).rejects.toThrow(/Unique constraint/i);

    await db.product.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    const second = await db.product.create({
      data: { storeId: store.id, title: "Second", slug: "reusable", basePrice: 100 },
    });
    expect(second.slug).toBe("reusable");
  });

  it("SKUs are unique only among non-deleted variants", async () => {
    const p = await db.product.create({ data: { storeId: store.id, title: "V", slug: "v", basePrice: 1 } });
    const v = await db.variant.create({
      data: { storeId: store.id, productId: p.id, sku: "SKU-1", title: "a", price: 1 },
    });
    await expect(
      db.variant.create({ data: { storeId: store.id, productId: p.id, sku: "SKU-1", title: "b", price: 1 } }),
    ).rejects.toThrow(/Unique constraint/i);
    await db.variant.update({ where: { id: v.id }, data: { deletedAt: new Date() } });
    await expect(
      db.variant.create({ data: { storeId: store.id, productId: p.id, sku: "SKU-1", title: "c", price: 1 } }),
    ).resolves.toBeTruthy();
  });

  it("the same slug is allowed in different stores", async () => {
    const other = await createTestStore("c2");
    try {
      await db.category.create({ data: { storeId: store.id, name: "Shoes", slug: "shoes" } });
      await expect(
        forStore(other.id).category.create({ data: { storeId: other.id, name: "Shoes", slug: "shoes" } }),
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
      data: { storeId: store.id, title, slug: "bangla", description: "হাতে বোনা", basePrice: 1250000 },
    });
    const found = await db.product.findUnique({ where: { id: created.id } });
    expect(found?.title).toBe(title);
    expect(found?.description).toBe("হাতে বোনা");
  });
});
