"use client";

import {
  DESCRIPTION_MAX,
  combinationLabel,
  combinations,
  optionKey,
  slugify,
  sortAxes,
  suggestSku,
  transliterateBangla,
  valueIdFor,
  type AxisKey,
  type OptionAxis,
  type OptionValues,
} from "@repo/core/catalog-client";
import { cn } from "@repo/ui";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useMemo, useState } from "react";
import { saveProductAction } from "@/server/actions/catalog";
import { FieldMessage, FormMessage, SubmitButton } from "../form-bits";
import { ProductImages, type EditorImage } from "./product-images";

/*
 * Product editor: basic details, photos (existing products), option axes with
 * chips, the variant table and the slug. The whole state is posted as one JSON
 * field to saveProductAction, which validates with productInputSchema.
 */

export type EditorVariant = {
  id: string;
  optionValues: OptionValues;
  sku: string;
  price: string;
  salePrice: string;
  stock: string;
  isActive: boolean;
  imageId: string | null;
};

export type EditorProduct = {
  id: string;
  slug: string;
  titleBn: string;
  titleEn: string;
  descriptionBn: string;
  descriptionEn: string;
  categoryId: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  isFeatured: boolean;
  defaultPrice: string;
  options: OptionAxis[];
  variants: EditorVariant[];
  images: EditorImage[];
};

type Row = {
  sku: string;
  price: string;
  salePrice: string;
  stock: string;
  isActive: boolean;
  existing: boolean;
};

const input =
  "h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-base dark:border-neutral-700 dark:bg-neutral-900";
const invalid = "border-red-500";

export function ProductEditor({
  product,
  categories,
}: {
  product: EditorProduct | null;
  categories: { id: string; name: string; depth: number }[];
}) {
  const t = useTranslations("catalog.editor");
  const tst = useTranslations("catalog.status");
  const locale = useLocale() as "bn" | "en";
  const [state, action] = useActionState(saveProductAction, null);

  const [basic, setBasic] = useState({
    titleBn: product?.titleBn ?? "",
    titleEn: product?.titleEn ?? "",
    descriptionBn: product?.descriptionBn ?? "",
    descriptionEn: product?.descriptionEn ?? "",
    categoryId: product?.categoryId ?? "",
    status: product?.status ?? ("DRAFT" as const),
    isFeatured: product?.isFeatured ?? false,
    defaultPrice: product?.defaultPrice ?? "",
    slug: product?.slug ?? "",
  });
  const [axes, setAxes] = useState<OptionAxis[]>(product?.options ?? []);
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      (product?.variants ?? []).map((v) => [
        optionKey(v.optionValues),
        {
          sku: v.sku,
          price: v.price,
          salePrice: v.salePrice,
          stock: v.stock,
          isActive: v.isActive,
          existing: true,
        },
      ]),
    ),
  );
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  const combos = useMemo(() => combinations(axes), [axes]);
  // Same base the server uses for a new product's slug (and so for its suggested SKUs).
  const slugBase =
    basic.slug ||
    product?.slug ||
    slugify(basic.titleEn) ||
    slugify(transliterateBangla(basic.titleBn)) ||
    "product";
  const rowFor = (key: string): Row =>
    rows[key] ?? { sku: "", price: "", salePrice: "", stock: "", isActive: true, existing: false };
  const setRow = (key: string, patch: Partial<Row>) => {
    touch();
    setRows((r) => ({ ...r, [key]: { ...rowFor(key), ...patch } }));
  };

  // Unsaved-changes guard: browser navigation and in-app links.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[href]");
      if (a && !a.hasAttribute("download") && !window.confirm(t("unsavedConfirm"))) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, t]);

  const payload = JSON.stringify({
    ...basic,
    categoryId: basic.categoryId || null,
    slug: basic.slug || undefined,
    isFeatured: basic.isFeatured,
    options: axes,
    variants: combos.map((combo) => {
      const r = rowFor(optionKey(combo));
      return {
        optionValues: combo,
        sku: r.sku || undefined,
        price: r.price || undefined,
        salePrice: r.salePrice,
        stock: r.stock || undefined,
        isActive: r.isActive,
      };
    }),
  });

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const err = (path: string) => errors[path];
  const detail = state && !state.ok ? (state.data?.detail as string | undefined) : undefined;

  // Axes ------------------------------------------------------------------
  const addAxis = (key: AxisKey) => {
    touch();
    setAxes((a) => sortAxes([...a, { key, values: [] }]));
  };
  const removeAxis = (key: AxisKey) => {
    touch();
    setAxes((a) => a.filter((x) => x.key !== key));
  };
  const addValue = (key: AxisKey, value: { bn: string; en: string; hex?: string }) => {
    touch();
    setAxes((a) =>
      a.map((x) =>
        x.key === key
          ? {
              ...x,
              values: [
                ...x.values,
                {
                  id: valueIdFor(
                    value,
                    x.values.map((v) => v.id),
                  ),
                  bn: value.bn || value.en,
                  en: value.en || value.bn,
                  ...(value.hex ? { hex: value.hex } : {}),
                },
              ],
            }
          : x,
      ),
    );
  };
  const removeValue = (key: AxisKey, id: string) => {
    touch();
    setAxes((a) => a.map((x) => (x.key === key ? { ...x, values: x.values.filter((v) => v.id !== id) } : x)));
  };
  const setHex = (id: string, hex: string) => {
    touch();
    setAxes((a) =>
      a.map((x) =>
        x.key === "colour" ? { ...x, values: x.values.map((v) => (v.id === id ? { ...v, hex } : v)) } : x,
      ),
    );
  };

  const [bulk, setBulk] = useState({ price: "", salePrice: "", stock: "" });
  const applyAll = (field: "price" | "salePrice" | "stock") => {
    touch();
    setRows((r) => {
      const next = { ...r };
      for (const combo of combos) {
        const key = optionKey(combo);
        next[key] = { ...rowFor(key), [field]: bulk[field] };
      }
      return next;
    });
  };

  const colourAxis = axes.find((a) => a.key === "colour");
  const linkedImage = (colourId: string) =>
    product?.variants.find((v) => v.optionValues.colour === colourId && v.imageId)?.imageId ?? null;

  return (
    <div className="flex flex-col gap-6 pb-24 md:pb-6">
      <form
        action={(fd) => {
          setDirty(false);
          action(fd);
        }}
        className="flex flex-col gap-6"
        noValidate
        id="product-form"
        data-product-form
      >
        <input type="hidden" name="productId" value={product?.id ?? ""} />
        <input type="hidden" name="payload" value={payload} />
        <FormMessage state={state} />

        <Section title={t("basic")}>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label={t("titleBn")}
              name="titleBn"
              lang="bn"
              value={basic.titleBn}
              errors={err("titleBn")}
              hint={t("titleHint")}
              onChange={(v) => {
                touch();
                setBasic((b) => ({ ...b, titleBn: v }));
              }}
            />
            <TextField
              label={t("titleEn")}
              name="titleEn"
              lang="en"
              value={basic.titleEn}
              errors={err("titleEn")}
              onChange={(v) => {
                touch();
                setBasic((b) => ({ ...b, titleEn: v }));
              }}
            />
            <TextArea
              label={t("descriptionBn")}
              name="descriptionBn"
              lang="bn"
              value={basic.descriptionBn}
              errors={err("descriptionBn")}
              hint={t("descriptionHint", { max: DESCRIPTION_MAX })}
              onChange={(v) => {
                touch();
                setBasic((b) => ({ ...b, descriptionBn: v }));
              }}
            />
            <TextArea
              label={t("descriptionEn")}
              name="descriptionEn"
              lang="en"
              value={basic.descriptionEn}
              errors={err("descriptionEn")}
              hint={t("descriptionHint", { max: DESCRIPTION_MAX })}
              onChange={(v) => {
                touch();
                setBasic((b) => ({ ...b, descriptionEn: v }));
              }}
            />
            <label className="flex flex-col gap-2 text-sm font-medium">
              {t("category")}
              <select
                className={cn(input, err("categoryId") && invalid)}
                value={basic.categoryId}
                name="categoryId"
                onChange={(e) => {
                  touch();
                  setBasic((b) => ({ ...b, categoryId: e.target.value }));
                }}
              >
                <option value="">{t("noCategory")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.depth ? "— " : ""}
                    {c.name}
                  </option>
                ))}
              </select>
              <FieldMessage id="f-categoryId" errors={err("categoryId")} />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              {t("status")}
              <select
                className={input}
                value={basic.status}
                name="status"
                data-status
                onChange={(e) => {
                  touch();
                  setBasic((b) => ({ ...b, status: e.target.value as typeof b.status }));
                }}
              >
                {(["DRAFT", "ACTIVE", "ARCHIVED"] as const).map((s) => (
                  <option key={s} value={s}>
                    {tst(s)}
                  </option>
                ))}
              </select>
            </label>
            <TextField
              label={t("defaultPrice")}
              name="defaultPrice"
              inputMode="decimal"
              value={basic.defaultPrice}
              errors={err("defaultPrice")}
              hint={t("defaultPriceHint")}
              onChange={(v) => {
                touch();
                setBasic((b) => ({ ...b, defaultPrice: v }));
              }}
            />
            <label className="flex min-h-11 items-center gap-3 self-end text-sm font-medium">
              <input
                type="checkbox"
                className="size-5"
                checked={basic.isFeatured}
                name="isFeatured"
                onChange={(e) => {
                  touch();
                  setBasic((b) => ({ ...b, isFeatured: e.target.checked }));
                }}
              />
              {t("featured")}
            </label>
          </div>
        </Section>

        <Section title={t("options")} hint={t("optionsHint")}>
          <div className="flex flex-col gap-4">
            {axes.map((axis, ai) => (
              <AxisEditor
                key={axis.key}
                axis={axis}
                errors={Object.entries(errors)
                  .filter(([k]) => k.startsWith(`options.${ai}`))
                  .flatMap(([, v]) => v)}
                onAdd={(v) => addValue(axis.key, v)}
                onRemove={(id) => removeValue(axis.key, id)}
                onHex={setHex}
                onRemoveAxis={() => removeAxis(axis.key)}
              />
            ))}
            <div className="flex flex-wrap gap-2">
              {!axes.some((a) => a.key === "size") ? (
                <button
                  type="button"
                  className={btnOutline}
                  onClick={() => addAxis("size")}
                  data-add-axis="size"
                >
                  {t("addSize")}
                </button>
              ) : null}
              {!axes.some((a) => a.key === "colour") ? (
                <button
                  type="button"
                  className={btnOutline}
                  onClick={() => addAxis("colour")}
                  data-add-axis="colour"
                >
                  {t("addColour")}
                </button>
              ) : null}
            </div>
          </div>
        </Section>

        <Section title={t("variants")} hint={t("variantsHint", { count: combos.length })}>
          {combos.length > 1 ? (
            <div
              className="grid gap-3 rounded-lg bg-neutral-50 p-3 sm:grid-cols-3 dark:bg-neutral-900"
              data-apply-all
            >
              {(["price", "salePrice", "stock"] as const).map((f) => (
                <div key={f} className="flex items-end gap-2">
                  <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
                    {t(f === "price" ? "applyPrice" : f === "salePrice" ? "applySale" : "applyStock")}
                    <input
                      className={input}
                      inputMode={f === "stock" ? "numeric" : "decimal"}
                      value={bulk[f]}
                      onChange={(e) => setBulk((b) => ({ ...b, [f]: e.target.value }))}
                      data-apply-input={f}
                    />
                  </label>
                  <button type="button" className={btnOutline} onClick={() => applyAll(f)} data-apply={f}>
                    {t("apply")}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <ul className="flex flex-col gap-3" data-variant-table>
            {combos.map((combo, i) => {
              const key = optionKey(combo);
              const r = rowFor(key);
              const rowErr = (f: string) => err(`variants.${i}.${f}`);
              const highlighted =
                detail !== undefined &&
                (detail === key ||
                  detail.toUpperCase() === (r.sku || suggestSku(slugBase, combo)).toUpperCase());
              return (
                <li
                  key={key}
                  data-variant={key}
                  className={cn(
                    "grid gap-3 rounded-lg border border-neutral-200 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))_minmax(0,1.4fr)_auto] lg:items-end dark:border-neutral-800",
                    highlighted && "border-red-500",
                  )}
                >
                  <p className="font-medium sm:col-span-2 lg:col-span-1 lg:self-center">
                    {combinationLabel(axes, combo, locale) || t("default")}
                  </p>
                  <TextField
                    label={t("columns.price")}
                    name={`price-${key}`}
                    inputMode="decimal"
                    value={r.price}
                    placeholder={basic.defaultPrice}
                    errors={rowErr("price")}
                    onChange={(v) => setRow(key, { price: v })}
                    compact
                  />
                  <TextField
                    label={t("columns.salePrice")}
                    name={`sale-${key}`}
                    inputMode="decimal"
                    value={r.salePrice}
                    errors={rowErr("salePrice")}
                    onChange={(v) => setRow(key, { salePrice: v })}
                    compact
                  />
                  <TextField
                    label={t("columns.stock")}
                    name={`stock-${key}`}
                    inputMode="numeric"
                    value={r.stock}
                    placeholder="0"
                    errors={rowErr("stock")}
                    onChange={(v) => setRow(key, { stock: v })}
                    compact
                  />
                  <TextField
                    label={t("columns.sku")}
                    name={`sku-${key}`}
                    value={r.sku}
                    placeholder={r.existing ? undefined : suggestSku(slugBase, combo)}
                    errors={rowErr("sku")}
                    onChange={(v) => setRow(key, { sku: v.toUpperCase() })}
                    compact
                  />
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={r.isActive}
                      onChange={(e) => setRow(key, { isActive: e.target.checked })}
                    />
                    {t("columns.active")}
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-neutral-500">{t("skuHint")}</p>
        </Section>

        <Section title={t("seo")}>
          <TextField
            label={t("slug")}
            name="slug"
            value={basic.slug}
            errors={err("slug")}
            hint={t("slugHint")}
            onChange={(v) => {
              touch();
              setBasic((b) => ({ ...b, slug: v.toLowerCase() }));
            }}
          />
        </Section>

        {/* Sticky save bar: above the mobile bottom navigation, inline on desktop. */}
        <div
          className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 rounded-lg border border-neutral-200 bg-white/95 p-3 shadow-lg backdrop-blur md:bottom-4 dark:border-neutral-800 dark:bg-neutral-950/95"
          data-save-bar
        >
          <span className="flex-1 text-sm text-neutral-500">{dirty ? t("unsaved") : null}</span>
          <SubmitButton className="w-auto px-6">{t("save")}</SubmitButton>
        </div>
      </form>

      {product ? (
        <Section imagesTitle>
          <ProductImages
            productId={product.id}
            initialImages={product.images}
            colours={(colourAxis?.values ?? []).map((v) => ({ ...v, imageId: linkedImage(v.id) }))}
          />
        </Section>
      ) : null}
    </div>
  );
}

const btnOutline =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700";

function Section({
  title,
  hint,
  children,
  imagesTitle,
}: {
  title?: string;
  hint?: string;
  children: React.ReactNode;
  imagesTitle?: boolean;
}) {
  const ti = useTranslations("catalog.images");
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{imagesTitle ? ti("title") : title}</h2>
        {hint ? <p className="text-sm text-neutral-500">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function TextField({
  label,
  name,
  value,
  onChange,
  errors,
  hint,
  lang,
  inputMode,
  placeholder,
  compact,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  errors?: string[];
  hint?: string;
  lang?: string;
  inputMode?: "decimal" | "numeric";
  placeholder?: string;
  compact?: boolean;
}) {
  const id = `f-${name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={cn("font-medium", compact ? "text-xs" : "text-sm")}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        value={value}
        lang={lang}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={errors ? true : undefined}
        aria-describedby={`${id}-msg`}
        className={cn(input, errors && invalid)}
      />
      {errors || hint ? <FieldMessage id={`${id}-msg`} errors={errors} hint={hint} /> : null}
    </div>
  );
}

function TextArea({
  label,
  name,
  value,
  onChange,
  errors,
  hint,
  lang,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  errors?: string[];
  hint?: string;
  lang: string;
}) {
  const id = `f-${name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        value={value}
        lang={lang}
        rows={5}
        maxLength={DESCRIPTION_MAX}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={errors ? true : undefined}
        className={cn(
          "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base dark:border-neutral-700 dark:bg-neutral-900",
          errors && invalid,
        )}
      />
      <FieldMessage id={`${id}-msg`} errors={errors} hint={hint} />
    </div>
  );
}

function AxisEditor({
  axis,
  errors,
  onAdd,
  onRemove,
  onHex,
  onRemoveAxis,
}: {
  axis: OptionAxis;
  errors: string[];
  onAdd: (v: { bn: string; en: string; hex?: string }) => void;
  onRemove: (id: string) => void;
  onHex: (id: string, hex: string) => void;
  onRemoveAxis: () => void;
}) {
  const t = useTranslations("catalog.editor");
  const locale = useLocale() as "bn" | "en";
  const [draft, setDraft] = useState({ bn: "", en: "", hex: "#000000" });
  const isColour = axis.key === "colour";
  const axisName = t(`axis.${axis.key}`);
  const add = () => {
    if (!draft.bn.trim() && !draft.en.trim()) return;
    onAdd({ bn: draft.bn.trim(), en: draft.en.trim(), ...(isColour ? { hex: draft.hex } : {}) });
    setDraft({ bn: "", en: "", hex: "#000000" });
  };
  return (
    <fieldset
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
      data-axis={axis.key}
    >
      <div className="flex items-center justify-between gap-2">
        <legend className="font-medium">{axisName}</legend>
        <button type="button" className={btnOutline} onClick={onRemoveAxis}>
          {t("removeAxis", { axis: axisName })}
        </button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {axis.values.map((v) => (
          <li
            key={v.id}
            className="flex min-h-11 items-center gap-2 rounded-full border border-neutral-300 py-1 pr-1 pl-3 text-sm dark:border-neutral-700"
            data-value={v.id}
          >
            {isColour ? (
              <label
                className="relative flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full"
                title={t("hex")}
              >
                <span
                  className="size-6 rounded-full border"
                  style={{ background: v.hex ?? "transparent" }}
                  aria-hidden
                />
                <span className="sr-only">{t("hex")}</span>
                <input
                  type="color"
                  value={v.hex ?? "#000000"}
                  onChange={(e) => onHex(v.id, e.target.value)}
                  className="absolute inset-0 opacity-0"
                />
              </label>
            ) : null}
            <span>{v[locale]}</span>
            <button
              type="button"
              onClick={() => onRemove(v.id)}
              className="flex size-11 items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800"
              aria-label={t("removeValue", { value: v[locale] })}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-xs font-medium">
          {t("valueBn")}
          <input
            className={input}
            lang="bn"
            value={draft.bn}
            onChange={(e) => setDraft((d) => ({ ...d, bn: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            data-new-value-bn
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          {t("valueEn")}
          <input
            className={input}
            lang="en"
            value={draft.en}
            onChange={(e) => setDraft((d) => ({ ...d, en: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            data-new-value-en
          />
        </label>
        {isColour ? (
          <label className="flex flex-col gap-1 text-xs font-medium">
            {t("hex")}
            <input
              type="color"
              className="h-11 w-14 rounded-md border border-neutral-300 dark:border-neutral-700"
              value={draft.hex}
              onChange={(e) => setDraft((d) => ({ ...d, hex: e.target.value }))}
            />
          </label>
        ) : null}
        <button type="button" className={btnOutline} onClick={add} data-add-value>
          {t("addValue")}
        </button>
      </div>
      {errors.length ? <p className="text-sm text-red-600 dark:text-red-400">{errors[0]}</p> : null}
    </fieldset>
  );
}
