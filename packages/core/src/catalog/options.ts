/**
 * Option axes and the variant matrix (pure, no dependencies; safe for client components).
 *
 *   options = [{ key: "size", values: [{ id: "m", bn: "M", en: "M" }, …] },
 *              { key: "colour", values: [{ id: "red", bn: "লাল", en: "Red", hex: "#dc2626" }, …] }]
 *   variant.option_values = { size: "m", colour: "red" }   option_key = "m|red"
 */
import { slugify, transliterateBangla } from "./slug";

export const AXIS_KEYS = ["size", "colour"] as const;
export type AxisKey = (typeof AXIS_KEYS)[number];
export const MAX_AXES = 2;
export const MAX_AXIS_VALUES = 20;

export type OptionValue = { id: string; bn: string; en: string; hex?: string };
export type OptionAxis = { key: AxisKey; values: OptionValue[] };
export type OptionValues = Partial<Record<AxisKey, string>>;

export const VALUE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "m|red", "m|", "|red" or "|" (matches the variants_option_key_chk CHECK). */
export function optionKey(values: OptionValues): string {
  return `${values.size ?? ""}|${values.colour ?? ""}`;
}

/** Axes in canonical order (size first), so combinations and keys are stable. */
export function sortAxes(axes: readonly OptionAxis[]): OptionAxis[] {
  return [...axes].sort((a, b) => AXIS_KEYS.indexOf(a.key) - AXIS_KEYS.indexOf(b.key));
}

/** A value id from its English label, else transliterated Bangla, unique within the axis. */
export function valueIdFor(value: { bn: string; en: string }, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = (slugify(value.en) || slugify(transliterateBangla(value.bn)) || "v")
    .slice(0, 32)
    .replace(/-+$/, "");
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Fills in missing value ids (new chips in the editor), keeping existing ones. */
export function assignValueIds(
  axes: readonly { key: AxisKey; values: (Omit<OptionValue, "id"> & { id?: string })[] }[],
): OptionAxis[] {
  return sortAxes(
    axes.map((axis) => {
      const used = new Set(axis.values.map((v) => v.id).filter((id): id is string => Boolean(id)));
      return {
        key: axis.key,
        values: axis.values.map((v) => {
          if (v.id) return { ...v, id: v.id };
          const id = valueIdFor(v, used);
          used.add(id);
          return { ...v, id };
        }),
      };
    }),
  );
}

/** Every combination of the axes' values; one empty combination for a simple product. */
export function combinations(axes: readonly OptionAxis[]): OptionValues[] {
  return sortAxes(axes).reduce<OptionValues[]>(
    (acc, axis) => acc.flatMap((combo) => axis.values.map((v) => ({ ...combo, [axis.key]: v.id }))),
    [{}],
  );
}

/** Human label of a combination in one language, e.g. "M / লাল". */
export function combinationLabel(
  axes: readonly OptionAxis[],
  values: OptionValues,
  lang: "bn" | "en",
): string {
  return sortAxes(axes)
    .map((axis) => axis.values.find((v) => v.id === values[axis.key])?.[lang])
    .filter(Boolean)
    .join(" / ");
}

/** `<PRODUCTSLUG>-<SIZE>-<COLOUR>`, uppercased, at most 64 chars. */
export function suggestSku(productSlug: string, values: OptionValues): string {
  return [productSlug, values.size, values.colour]
    .filter(Boolean)
    .join("-")
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "-")
    .slice(0, 64)
    .replace(/-+$/, "");
}

/** `sku` if free, else sku-2, sku-3, … (case-insensitive). */
export function uniqueSku(sku: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((s) => s.toUpperCase()));
  if (!used.has(sku.toUpperCase())) return sku;
  for (let n = 2; ; n++) {
    const candidate = `${sku.slice(0, 64 - String(n).length - 1)}-${n}`;
    if (!used.has(candidate.toUpperCase())) return candidate;
  }
}

// ---------------------------------------------------------------------------
// Reconcile variants after an axis edit
// ---------------------------------------------------------------------------

export type ExistingVariant = {
  id: string;
  optionKey: string;
  sku: string;
  price: number;
  salePrice: number | null;
  stock: number;
};

export type VariantFields = {
  sku: string;
  price: number;
  salePrice: number | null;
  stock: number;
  weightGrams: number | null;
  isActive: boolean;
};

/** A row the editor submitted for one combination (all fields already parsed to poisha etc.). */
export type SubmittedVariant = Partial<VariantFields> & { optionValues: OptionValues };

export type VariantPlan = {
  /** Existing variants still in the matrix (with any submitted changes). */
  update: { id: string; optionValues: OptionValues; fields: Partial<VariantFields> }[];
  /** New combinations. */
  create: { optionValues: OptionValues; fields: VariantFields }[];
  /** Existing variants whose combination is gone. */
  softDelete: string[];
};

/**
 * Plans the variant rows for `axes`: existing variants whose combination still
 * exists are kept (price/stock/SKU preserved unless the editor sent new values),
 * new combinations are created (default price, stock 0, suggested SKU), and
 * variants whose combination disappeared are soft-deleted.
 */
export function planVariants(input: {
  axes: readonly OptionAxis[];
  existing: readonly ExistingVariant[];
  submitted: readonly SubmittedVariant[];
  productSlug: string;
  defaultPrice: number;
  /** SKUs in use by the store's other variants (excluding this product's existing ones). */
  takenSkus: Iterable<string>;
}): VariantPlan {
  const combos = combinations(input.axes);
  const byKey = new Map(input.existing.map((v) => [v.optionKey, v]));
  const submittedByKey = new Map(input.submitted.map((s) => [optionKey(s.optionValues), s]));
  const wanted = new Set(combos.map(optionKey));
  const taken = new Set([...input.takenSkus].map((s) => s.toUpperCase()));
  // Kept variants keep their SKU (or the submitted one); reserve those first.
  for (const combo of combos) {
    const key = optionKey(combo);
    const existing = byKey.get(key);
    if (existing) taken.add((submittedByKey.get(key)?.sku ?? existing.sku).toUpperCase());
  }

  const plan: VariantPlan = { update: [], create: [], softDelete: [] };
  for (const combo of combos) {
    const key = optionKey(combo);
    const existing = byKey.get(key);
    const sent = submittedByKey.get(key);
    const { optionValues: _ignored, ...fields } = sent ?? { optionValues: combo };
    if (existing) {
      plan.update.push({ id: existing.id, optionValues: combo, fields });
      continue;
    }
    // A SKU the seller typed is kept as is (a clash is reported as SKU_TAKEN);
    // a suggested one gets a -2/-3 suffix when needed.
    const typed = fields.sku?.trim();
    const sku = typed || uniqueSku(suggestSku(input.productSlug, combo), taken);
    taken.add(sku.toUpperCase());
    plan.create.push({
      optionValues: combo,
      fields: {
        sku,
        price: fields.price ?? input.defaultPrice,
        salePrice: fields.salePrice ?? null,
        stock: fields.stock ?? 0,
        weightGrams: fields.weightGrams ?? null,
        isActive: fields.isActive ?? true,
      },
    });
  }
  for (const v of input.existing) if (!wanted.has(v.optionKey)) plan.softDelete.push(v.id);
  return plan;
}
