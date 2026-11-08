import { describe, expect, it } from "vitest";
import {
  assignValueIds,
  combinationLabel,
  combinations,
  optionKey,
  planVariants,
  suggestSku,
  uniqueSku,
  valueIdFor,
  type OptionAxis,
} from "../src/catalog/options";
import {
  bulkInputSchema,
  categoryInputSchema,
  productInputSchema,
  stockUpdateSchema,
} from "../src/catalog/schemas";
import { baseSlug, nextFreeSlug, slugify, transliterateBangla } from "../src/catalog/slug";

const SIZE: OptionAxis = {
  key: "size",
  values: [
    { id: "s", bn: "S", en: "S" },
    { id: "m", bn: "M", en: "M" },
    { id: "l", bn: "L", en: "L" },
  ],
};
const COLOUR: OptionAxis = {
  key: "colour",
  values: [
    { id: "red", bn: "লাল", en: "Red", hex: "#dc2626" },
    { id: "blue", bn: "নীল", en: "Blue", hex: "#1d4ed8" },
  ],
};

describe("slugs", () => {
  it("slugify: lowercase a–z0–9 with single hyphens", () => {
    expect(slugify("  Cotton Panjabi — Eid 2026!  ")).toBe("cotton-panjabi-eid-2026");
    expect(slugify("Café & Crème")).toBe("cafe-and-creme");
    expect(slugify("জামদানি")).toBe("");
  });

  it("transliterates Bangla when there is no English name", () => {
    expect(transliterateBangla("জামদানি শাড়ি")).toBe("jamdani shari");
    expect(transliterateBangla("পাঞ্জাবি")).toBe("panjabi");
    expect(transliterateBangla("আম")).toBe("am");
    expect(baseSlug("", "সুতির পাঞ্জাবি")).toBe("sutir-panjabi");
    expect(baseSlug("Silk Panjabi", "সিল্ক পাঞ্জাবি")).toBe("silk-panjabi");
    expect(baseSlug(undefined, "😀")).toMatch(/^item-[a-z0-9]{6}$/);
  });

  it("adds -2, -3 … when a slug is taken", () => {
    expect(nextFreeSlug("shirt", [])).toBe("shirt");
    expect(nextFreeSlug("shirt", ["shirt", "shirt-2"])).toBe("shirt-3");
    expect(nextFreeSlug("a".repeat(80), ["a".repeat(80)])).toHaveLength(80);
  });
});

describe("option axes and the variant matrix", () => {
  it("generates every combination (size first), one empty one for a simple product", () => {
    expect(combinations([COLOUR, SIZE]).map(optionKey)).toEqual([
      "s|red",
      "s|blue",
      "m|red",
      "m|blue",
      "l|red",
      "l|blue",
    ]);
    expect(combinations([])).toEqual([{}]);
    expect(optionKey({})).toBe("|");
    expect(combinationLabel([SIZE, COLOUR], { size: "m", colour: "red" }, "bn")).toBe("M / লাল");
  });

  it("assigns value ids from the English label, then Bangla, unique per axis", () => {
    expect(valueIdFor({ bn: "লাল", en: "Red" }, [])).toBe("red");
    expect(valueIdFor({ bn: "লাল", en: "Red" }, ["red"])).toBe("red-2");
    expect(valueIdFor({ bn: "লাল", en: "" }, [])).toBe("lal");
    const axes = assignValueIds([
      {
        key: "colour",
        values: [
          { bn: "লাল", en: "Red" },
          { id: "x", bn: "নীল", en: "Blue" },
        ],
      },
      { key: "size", values: [{ bn: "XL", en: "XL" }] },
    ]);
    expect(axes.map((a) => a.key)).toEqual(["size", "colour"]);
    expect(axes[1]!.values.map((v) => v.id)).toEqual(["red", "x"]);
  });

  it("suggests <SLUG>-<SIZE>-<COLOUR> SKUs and keeps them unique", () => {
    expect(suggestSku("cotton-panjabi", { size: "m", colour: "red" })).toBe("COTTON-PANJABI-M-RED");
    expect(suggestSku("jamdani", {})).toBe("JAMDANI");
    expect(uniqueSku("ABC", ["abc", "ABC-2"])).toBe("ABC-3");
  });

  it("keeps matching variants, creates new combinations and soft-deletes removed ones", () => {
    const existing = combinations([SIZE, COLOUR]).map((c, i) => ({
      id: `v${i}`,
      optionKey: optionKey(c),
      sku: suggestSku("tee", c),
      price: 50000,
      salePrice: null,
      stock: 10 + i,
    }));
    // Remove L, add XL.
    const sizes: OptionAxis = {
      key: "size",
      values: [...SIZE.values.slice(0, 2), { id: "xl", bn: "XL", en: "XL" }],
    };
    const plan = planVariants({
      axes: [sizes, COLOUR],
      existing,
      submitted: [{ optionValues: { size: "s", colour: "red" }, stock: 99 }],
      productSlug: "tee",
      defaultPrice: 60000,
      takenSkus: ["TEE-XL-BLUE"],
    });
    expect(plan.update.map((u) => u.id)).toEqual(["v0", "v1", "v2", "v3"]);
    expect(plan.update[0]!.fields).toEqual({ stock: 99 }); // only submitted fields change
    expect(plan.softDelete.sort()).toEqual(["v4", "v5"]); // l|red, l|blue
    expect(plan.create).toEqual([
      {
        optionValues: { size: "xl", colour: "red" },
        fields: {
          sku: "TEE-XL-RED",
          price: 60000,
          salePrice: null,
          stock: 0,
          weightGrams: null,
          isActive: true,
        },
      },
      {
        optionValues: { size: "xl", colour: "blue" },
        fields: {
          sku: "TEE-XL-BLUE-2",
          price: 60000,
          salePrice: null,
          stock: 0,
          weightGrams: null,
          isActive: true,
        },
      },
    ]);
  });

  it("adding a first axis to a simple product replaces its default variant", () => {
    const plan = planVariants({
      axes: [SIZE],
      existing: [{ id: "d", optionKey: "|", sku: "TEE", price: 1, salePrice: null, stock: 3 }],
      submitted: [],
      productSlug: "tee",
      defaultPrice: 100,
      takenSkus: [],
    });
    expect(plan.softDelete).toEqual(["d"]);
    expect(plan.create.map((c) => c.fields.sku)).toEqual(["TEE-S", "TEE-M", "TEE-L"]);
  });
});

describe("schemas", () => {
  const base = { titleBn: "শার্ট", defaultPrice: "৫০০" };

  it("parses taka with Bangla digits into poisha and copies a missing title", () => {
    const p = productInputSchema.parse({ ...base, variants: [{ price: "১,২০০.৫০", stock: "৭" }] });
    expect(p.defaultPrice).toBe(50000);
    expect(p.titleEn).toBe("শার্ট");
    expect(p.variants[0]).toMatchObject({ price: 120050, stock: 7 });
    expect(productInputSchema.safeParse({ defaultPrice: "1" }).error?.issues[0]?.message).toBe(
      "TITLE_REQUIRED",
    );
  });

  it("rejects a sale price at or above the price", () => {
    const r = productInputSchema.safeParse({
      ...base,
      variants: [{ price: "100", salePrice: "100" }, { salePrice: "499.99" }, { salePrice: "500" }],
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => [i.path.join("."), i.message])).toEqual([
      ["variants.0.salePrice", "SALE_PRICE_TOO_HIGH"],
      ["variants.2.salePrice", "SALE_PRICE_TOO_HIGH"],
    ]);
  });

  it("limits axes, values and descriptions", () => {
    const values = Array.from({ length: 21 }, (_, i) => ({ en: `V${i}` }));
    const codes = (input: object) =>
      productInputSchema.safeParse({ ...base, ...input }).error?.issues.map((i) => i.message) ?? [];
    expect(codes({ options: [{ key: "size", values }] })).toContain("TOO_MANY_VALUES");
    expect(codes({ options: [{ key: "size", values: [] }] })).toContain("AXIS_EMPTY");
    expect(
      codes({
        options: [
          { key: "size", values: [{ en: "M" }] },
          { key: "size", values: [{ en: "L" }] },
        ],
      }),
    ).toContain("DUPLICATE_AXIS");
    expect(codes({ options: [{ key: "colour", values: [{ en: "Red" }, { en: "red" }] }] })).toContain(
      "DUPLICATE_VALUE",
    );
    expect(codes({ options: [{ key: "weight", values: [{ en: "1" }] }] })).toContain("INVALID");
    expect(codes({ descriptionBn: "অ".repeat(5001) })).toContain("TOO_LONG");
    expect(codes({ variants: [{ stock: "-1" }] })).toContain("INVALID_STOCK");
    expect(codes({ variants: [{ sku: "bad sku!" }] })).toContain("INVALID_SKU");
    expect(codes({ slug: "Not A Slug" })).toContain("INVALID_SLUG");
    // Line breaks are kept (normalised to \n).
    expect(productInputSchema.parse({ ...base, descriptionEn: "a\r\nb" }).descriptionEn).toBe("a\nb");
  });

  it("category, stock and bulk inputs", () => {
    expect(categoryInputSchema.parse({ nameEn: "Shoes" })).toMatchObject({ nameBn: "Shoes", isActive: true });
    expect(categoryInputSchema.safeParse({}).error?.issues[0]?.message).toBe("NAME_REQUIRED");
    expect(
      stockUpdateSchema.parse({ variantId: "v", stock: "১২", expectedUpdatedAt: "2026-11-09T10:00:00.000Z" }),
    ).toMatchObject({ stock: 12 });
    expect(bulkInputSchema.safeParse({ ids: [], action: "publish" }).error?.issues[0]?.message).toBe(
      "NOTHING_SELECTED",
    );
  });
});
