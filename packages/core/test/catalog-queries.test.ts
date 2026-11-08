import { disconnectAll } from "@repo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  catalogStats,
  categoryInputSchema,
  createCategory,
  createProduct,
  listProducts,
  listTrash,
  productInputSchema,
  softDeleteProducts,
} from "../src/catalog";
import { createTestStore, deleteStores } from "./helpers";

let s: { id: string };
let other: { id: string };
const ids: Record<string, string> = {};

beforeAll(async () => {
  s = await createTestStore("q");
  other = await createTestStore("q-other");
  const parent = await createCategory(s.id, categoryInputSchema.parse({ nameEn: "Parent" }));
  if (!parent.ok) throw new Error(parent.error);
  const child = await createCategory(
    s.id,
    categoryInputSchema.parse({ nameEn: "Child", parentId: parent.id }),
  );
  if (!child.ok) throw new Error(child.error);
  ids.parent = parent.id;
  const make = async (key: string, input: Record<string, unknown>) => {
    const r = await createProduct(s.id, productInputSchema.parse({ defaultPrice: "100", ...input }));
    if (!r.ok) throw new Error(r.error);
    ids[key] = r.id;
  };
  await make("mango", {
    titleBn: "আম",
    titleEn: "Mango",
    status: "ACTIVE",
    variants: [{ stock: "50", price: "300" }],
    categoryId: parent.id,
  });
  await make("shirt", {
    titleEn: "Shirt",
    variants: [{ stock: "3", sku: "SHIRT-RED-XL", price: "500", salePrice: "450" }],
    categoryId: child.id,
  });
  await make("saree", {
    titleBn: "শাড়ি",
    titleEn: "Saree",
    status: "ACTIVE",
    variants: [{ stock: "0", price: "200" }],
    isFeatured: "on",
  });
  await make("gone", { titleEn: "Gone", variants: [{ stock: "9" }] });
  await softDeleteProducts(s.id, [ids.gone!]);
  const r = await createProduct(other.id, productInputSchema.parse({ titleEn: "Mango", defaultPrice: "1" }));
  if (!r.ok) throw new Error(r.error);
});

afterAll(async () => {
  await deleteStores(s.id, other.id);
  await disconnectAll();
});

const titles = async (filters: Parameters<typeof listProducts>[1]) =>
  (await listProducts(s.id, filters)).rows.map((r) => r.titleEn);

describe("admin product list", () => {
  it("searches bn/en titles and SKUs, never the trash or another store", async () => {
    expect(await titles({ q: "mango" })).toEqual(["Mango"]);
    expect(await titles({ q: "আম" })).toEqual(["Mango"]);
    expect(await titles({ q: "red-x" })).toEqual(["Shirt"]);
    expect(await titles({ q: "gone" })).toEqual([]);
    expect(await titles({ q: "%" })).toEqual([]);
    expect((await listProducts(s.id, {})).total).toBe(3);
  });

  it("filters by status, featured, category (with children) and stock (in / low ≤ 5 / out)", async () => {
    expect(await titles({ status: "ACTIVE", sort: "name", locale: "en" })).toEqual(["Mango", "Saree"]);
    expect(await titles({ featured: true })).toEqual(["Saree"]);
    expect((await titles({ categoryId: ids.parent })).sort()).toEqual(["Mango", "Shirt"]);
    expect(await titles({ stock: "out" })).toEqual(["Saree"]);
    expect(await titles({ stock: "low" })).toEqual(["Shirt"]);
    expect(await titles({ stock: "in" })).toEqual(["Mango"]);
  });

  it("sorts by price (effective) and stock, and paginates", async () => {
    expect(await titles({ sort: "price" })).toEqual(["Saree", "Mango", "Shirt"]);
    expect(await titles({ sort: "stock" })).toEqual(["Saree", "Shirt", "Mango"]);
    const shirt = (await listProducts(s.id, { q: "shirt" })).rows[0]!;
    expect(shirt.price).toEqual({ amount: 45000, regular: 50000 });
    expect(shirt.totalStock).toBe(3);
    expect(await listProducts(s.id, { page: 2 })).toMatchObject({ rows: [], total: 0, page: 2 });
  });

  it("trash and dashboard numbers", async () => {
    expect((await listTrash(s.id)).map((r) => r.titleEn)).toEqual(["Gone"]);
    expect(await catalogStats(s.id)).toMatchObject({
      active: 2,
      drafts: 1,
      outOfStock: 1,
      lowStock: 0,
      categories: 2,
    });
  });
});
