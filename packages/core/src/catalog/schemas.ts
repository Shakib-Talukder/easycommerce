/**
 * Catalogue input schemas. They take raw editor values (strings, taka amounts with
 * Bangla digits, "on" checkboxes) and report error codes as issue messages.
 * Client-safe: only depends on zod and @repo/db/money.
 */
import { normalizeDigits, takaToPoisha } from "@repo/db/money";
import { z } from "zod";
import { AXIS_KEYS, MAX_AXES, MAX_AXIS_VALUES, VALUE_ID_PATTERN } from "./options";
import { SLUG_MAX, SLUG_PATTERN } from "./slug";

export const PRODUCT_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export type ProductStatusValue = (typeof PRODUCT_STATUSES)[number];
export const DESCRIPTION_MAX = 5000;
export const CATEGORY_DESCRIPTION_MAX = 1000;
export const TITLE_MAX = 200;
export const NAME_MAX = 100;
export const ALT_MAX = 200;
export const MAX_IMAGES_PER_PRODUCT = 10;
export const MAX_FEATURED = 12;
export const LOW_STOCK = 5;
export const MAX_STOCK = 1_000_000;

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const blankToUndefined = (v: unknown) => (isBlank(v) ? undefined : v);
const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());
/** Plain text; Windows line breaks normalised. */
const text = (max: number) =>
  z.preprocess(
    (v) => (isBlank(v) ? undefined : typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : v),
    z.string().max(max, "TOO_LONG").optional(),
  );
const label = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max, "TOO_LONG").optional());

/** Taka (string with optional Bangla digits / commas, or a number) → poisha. */
export const takaSchema = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return takaToPoisha(v);
  } catch {
    ctx.addIssue({ code: "custom", message: "INVALID_AMOUNT" });
    return z.NEVER;
  }
});
const optionalTaka = z.preprocess(blankToUndefined, takaSchema.optional());
const nullableTaka = z.preprocess((v) => (isBlank(v) ? null : v), takaSchema.nullable());

const intFrom = (code: string, max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? Number(normalizeDigits(v).trim()) : v),
    z.number({ error: code }).int(code).min(0, code).max(max, code),
  );
export const stockSchema = intFrom("INVALID_STOCK", MAX_STOCK);
const optionalStock = z.preprocess(blankToUndefined, stockSchema.optional());
const optionalWeight = z.preprocess(
  (v) => (isBlank(v) ? null : v),
  intFrom("INVALID_WEIGHT", 1_000_000).nullable(),
);

export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/, "INVALID_SKU");

export const slugInputSchema = z.preprocess(
  blankToUndefined,
  z.string().trim().toLowerCase().max(SLUG_MAX, "TOO_LONG").regex(SLUG_PATTERN, "INVALID_SLUG").optional(),
);

const idSchema = z.string().trim().min(1).max(40);
const nullableId = z.preprocess((v) => (isBlank(v) ? null : v), idSchema.nullable());

/** At least one of bn/en is required; a blank one copies the other (both columns are NOT NULL). */
function pickBoth(bn: string | undefined, en: string | undefined) {
  return bn || en ? { bn: (bn ?? en)!, en: (en ?? bn)! } : null;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categoryInputSchema = z
  .object({
    nameBn: label(NAME_MAX),
    nameEn: label(NAME_MAX),
    slug: slugInputSchema,
    descriptionBn: text(CATEGORY_DESCRIPTION_MAX),
    descriptionEn: text(CATEGORY_DESCRIPTION_MAX),
    parentId: nullableId.optional(),
    isActive: checkbox.default(true),
  })
  .transform((v, ctx) => {
    const names = pickBoth(v.nameBn, v.nameEn);
    if (!names) {
      ctx.addIssue({ code: "custom", path: ["nameBn"], message: "NAME_REQUIRED" });
      return z.NEVER;
    }
    return { ...v, nameBn: names.bn, nameEn: names.en };
  });
export type CategoryInput = z.output<typeof categoryInputSchema>;

// ---------------------------------------------------------------------------
// Options and variants
// ---------------------------------------------------------------------------

const optionValueSchema = z
  .object({
    id: z.preprocess(
      blankToUndefined,
      z.string().trim().regex(VALUE_ID_PATTERN, "INVALID").max(40).optional(),
    ),
    bn: label(40),
    en: label(40),
    hex: z.preprocess(
      blankToUndefined,
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^#[0-9a-f]{6}$/, "INVALID_COLOR")
        .optional(),
    ),
  })
  .transform((v, ctx) => {
    if (!v.bn && !v.en) {
      ctx.addIssue({ code: "custom", path: ["bn"], message: "REQUIRED" });
      return z.NEVER;
    }
    return { ...v, bn: v.bn ?? v.en!, en: v.en ?? v.bn! };
  });

export const optionAxesSchema = z
  .array(
    z.object({
      key: z.enum(AXIS_KEYS, { error: "INVALID" }),
      values: z.array(optionValueSchema).min(1, "AXIS_EMPTY").max(MAX_AXIS_VALUES, "TOO_MANY_VALUES"),
    }),
  )
  .max(MAX_AXES, "TOO_MANY_AXES")
  .superRefine((axes, ctx) => {
    const keys = axes.map((a) => a.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "DUPLICATE_AXIS" });
    axes.forEach((axis, i) => {
      const seen = new Set<string>();
      const ids = new Set<string>();
      axis.values.forEach((v, j) => {
        const name = v.en.toLowerCase();
        if (seen.has(name) || (v.id && ids.has(v.id))) {
          ctx.addIssue({ code: "custom", path: [i, "values", j, "en"], message: "DUPLICATE_VALUE" });
        }
        seen.add(name);
        if (v.id) ids.add(v.id);
      });
    });
  });

export const variantRowSchema = z.object({
  optionValues: z.object({ size: z.string().optional(), colour: z.string().optional() }).strict().default({}),
  sku: z.preprocess(blankToUndefined, skuSchema.optional()),
  price: optionalTaka,
  salePrice: nullableTaka.optional(),
  stock: optionalStock,
  weightGrams: optionalWeight.optional(),
  isActive: z.preprocess(
    (v) => (v === undefined ? undefined : v === true || v === "on" || v === "true"),
    z.boolean().optional(),
  ),
});
export type VariantRowInput = z.output<typeof variantRowSchema>;

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const productInputSchema = z
  .object({
    titleBn: label(TITLE_MAX),
    titleEn: label(TITLE_MAX),
    slug: slugInputSchema,
    descriptionBn: text(DESCRIPTION_MAX),
    descriptionEn: text(DESCRIPTION_MAX),
    categoryId: nullableId.optional(),
    status: z.enum(PRODUCT_STATUSES, { error: "INVALID_STATUS" }).default("DRAFT"),
    isFeatured: checkbox.default(false),
    /** Price for combinations that don't have their own yet (taka). */
    defaultPrice: takaSchema,
    options: optionAxesSchema.default([]),
    variants: z.array(variantRowSchema).max(400).default([]),
  })
  .transform((p, ctx) => {
    const titles = pickBoth(p.titleBn, p.titleEn);
    if (!titles) ctx.addIssue({ code: "custom", path: ["titleBn"], message: "TITLE_REQUIRED" });
    p.variants.forEach((row, i) => {
      const price = row.price ?? p.defaultPrice;
      if (row.salePrice !== undefined && row.salePrice !== null && row.salePrice >= price) {
        ctx.addIssue({ code: "custom", path: ["variants", i, "salePrice"], message: "SALE_PRICE_TOO_HIGH" });
      }
    });
    if (!titles) return z.NEVER;
    return { ...p, titleBn: titles.bn, titleEn: titles.en };
  });
export type ProductInput = z.output<typeof productInputSchema>;

export const stockUpdateSchema = z.object({
  variantId: idSchema,
  stock: stockSchema,
  /** The variant's updated_at the editor saw (ISO string). */
  expectedUpdatedAt: z.coerce.date({ error: "INVALID" }),
});

export const imageMetaSchema = z.object({ altBn: label(ALT_MAX), altEn: label(ALT_MAX) });

export const BULK_ACTIONS = [
  "publish",
  "unpublish",
  "archive",
  "feature",
  "unfeature",
  "move",
  "delete",
] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export const bulkInputSchema = z.object({
  ids: z.array(idSchema).min(1, "NOTHING_SELECTED").max(100),
  action: z.enum(BULK_ACTIONS, { error: "INVALID" }),
  categoryId: nullableId.optional(),
});
