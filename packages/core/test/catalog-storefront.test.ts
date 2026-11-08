import { disconnectAll, forStore } from "@repo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  categoryInputSchema,
  createCategory,
  createProduct,
  productInputSchema,
  softDeleteProducts,
  storefrontCategory,
  storefrontHome,
  storefrontProduct,
  updateCategory,
} from "../src/catalog";
import { createTestStore, deleteStores } from "./helpers";

let s: { id: string };
let other: { id: string };
const ids: Record<string, string> = {};

async function product(key: string, input: Record<string, unknown>, storeId = s.id) {
  const r = await createProduct(
    storeId,
    productInputSchema.parse({ defaultPrice: "100", status: "ACTIVE", ...input }),
  );
  if (!r.ok) throw new Error(r.error);
  ids[key] = r.id;
}
async function category(key: string, input: Record<string, unknown>) {
  const r = await createCategory(s.id, categoryInputSchema.parse(input));
  if (!r.ok) throw new Error(r.error);
  ids[key] = r.id;
}

beforeAll(async () => {
  s = await createTestStore("sf");
  other = await createTestStore("sf-other");
  await category("clothes", { nameEn: "Clothes", slug: "clothes" });
  await category("shirts", { nameEn: "Shirts", slug: "shirts", parentId: ids.clothes });
  await category("hidden", { nameEn: "Hidden", slug: "hidden", isActive: "false" });
  await product("live", {
    titleEn: "Live Shirt",
    slug: "live-shirt",
    categoryId: ids.shirts,
    variants: [{ price: "300", salePrice: "250", stock: "2" }],
  });
  await product("cheap", {
    titleEn: "Cheap Coat",
    slug: "cheap-coat",
    categoryId: ids.clothes,
    variants: [{ price: "50", stock: "0" }],
  });
  await product("draft", { titleEn: "Draft", slug: "draft", status: "DRAFT", categoryId: ids.clothes });
  await product("archived", {
    titleEn: "Archived",
    slug: "archived",
    status: "ARCHIVED",
    categoryId: ids.clothes,
  });
  await product("trashed", { titleEn: "Trashed", slug: "trashed", categoryId: ids.clothes });
  await softDeleteProducts(s.id, [ids.trashed!]);
  await product("featured2", { titleEn: "Second", slug: "second", isFeatured: "on" });
  await product("featured1", { titleEn: "First", slug: "first", isFeatured: "on" });
  await forStore(s.id).product.update({ where: { id: ids.featured1! }, data: { featuredOrder: 0 } });
  await forStore(s.id).product.update({ where: { id: ids.featured2! }, data: { featuredOrder: 5 } });
  await product("foreign", { titleEn: "Foreign", slug: "foreign" }, other.id);
});

afterAll(async () => {
  await deleteStores(s.id, other.id);
  await disconnectAll();
});

describe("storefront visibility", () => {
  it("product pages: only ACTIVE, non-deleted products of this store", async () => {
    expect(await storefrontProduct(s.id, "live-shirt")).toMatchObject({
      titleEn: "Live Shirt",
      category: { slug: "shirts" },
    });
    for (const slug of ["draft", "archived", "trashed", "foreign", "nope"]) {
      expect(await storefrontProduct(s.id, slug), slug).toBeNull();
    }
  });

  it("variants: inactive and deleted variants are not offered", async () => {
    await forStore(s.id).variant.updateMany({ where: { productId: ids.cheap }, data: { isActive: false } });
    expect((await storefrontProduct(s.id, "cheap-coat"))!.variants).toEqual([]);
    await forStore(s.id).variant.updateMany({ where: { productId: ids.cheap }, data: { isActive: true } });
  });

  it("category pages: products of the category and its children, never hidden ones", async () => {
    const page = await storefrontCategory(s.id, "clothes", { sort: "price-asc" });
    expect(page!.products.map((p) => p.titleEn)).toEqual(["Cheap Coat", "Live Shirt"]);
    expect(page!.children.map((c) => c.slug)).toEqual(["shirts"]);
    const desc = await storefrontCategory(s.id, "clothes", { sort: "price-desc" });
    expect(desc!.products.map((p) => p.titleEn)).toEqual(["Live Shirt", "Cheap Coat"]);
    expect((await storefrontCategory(s.id, "shirts"))!.parent?.slug).toBe("clothes");
    expect(await storefrontCategory(s.id, "hidden")).toBeNull();
    expect(await storefrontCategory(s.id, "missing")).toBeNull();
  });

  it("an inactive parent hides its children, a deleted category is gone", async () => {
    const input = categoryInputSchema.parse({ nameEn: "Clothes", slug: "clothes", isActive: "false" });
    await updateCategory(s.id, ids.clothes!, input);
    expect(await storefrontCategory(s.id, "shirts")).toBeNull();
    await updateCategory(
      s.id,
      ids.clothes!,
      categoryInputSchema.parse({ nameEn: "Clothes", slug: "clothes" }),
    );
    await forStore(s.id).category.update({ where: { id: ids.shirts! }, data: { deletedAt: new Date() } });
    expect(await storefrontCategory(s.id, "shirts")).toBeNull();
    await forStore(s.id).category.update({ where: { id: ids.shirts! }, data: { deletedAt: null } });
  });

  it("home: featured in featured order, newest, visible top-level categories; cards carry sale and stock", async () => {
    const home = await storefrontHome(s.id);
    expect(home.featured.map((p) => p.titleEn)).toEqual(["First", "Second"]);
    expect(home.newest.map((p) => p.titleEn)).not.toContain("Draft");
    expect(home.newest.map((p) => p.titleEn)).not.toContain("Trashed");
    expect(home.categories.map((c) => c.slug)).toEqual(["clothes"]);
    const live = home.newest.find((p) => p.titleEn === "Live Shirt")!;
    expect(live).toMatchObject({ price: 25000, regularPrice: 30000, inStock: true });
    expect(home.newest.find((p) => p.titleEn === "Cheap Coat")).toMatchObject({
      inStock: false,
      regularPrice: null,
    });
  });
});
