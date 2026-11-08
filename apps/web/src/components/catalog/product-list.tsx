"use client";

import { formatBDT } from "@repo/db/money";
import { cn } from "@repo/ui";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useState } from "react";
import { bulkProductsAction, quickStockAction } from "@/server/actions/catalog";
import { FormMessage } from "../form-bits";

export type ListItem = {
  id: string;
  title: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  isFeatured: boolean;
  thumb: string | null;
  price: { amount: number; regular: number | null } | null;
  totalStock: number;
  variants: { id: string; label: string; stock: number; updatedAt: string }[];
};

const LOW = 5;
const BULK_FORM = "bulk-products";

const statusStyle = {
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  DRAFT: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  ARCHIVED: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
} as const;

/**
 * Product rows: cards on phones, a table-like grid from 768 px. Checkboxes feed
 * the bulk-action form (linked with the form attribute, so each row's quick-stock
 * forms aren't nested inside it).
 */
export function ProductList({
  items,
  categories,
}: {
  items: ListItem[];
  categories: { id: string; name: string; depth: number }[];
}) {
  const t = useTranslations("catalog.list");
  const ts = useTranslations("catalog.status");
  const locale = useLocale() as "bn" | "en";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, action] = useActionState(bulkProductsAction, null);
  const [bulk, setBulk] = useState("");
  const allSelected = selected.size === items.length && items.length > 0;
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const field =
    "h-11 rounded-md border border-neutral-300 bg-white px-3 text-base sm:text-sm dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <div className="flex flex-col gap-3">
      <FormMessage state={state} />
      <form id={BULK_FORM} action={action} className="contents" />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))}
          />
          {t("selectAll")}
        </label>
        {selected.size > 0 ? (
          <span className="text-sm text-neutral-500">{t("selected", { count: selected.size })}</span>
        ) : null}
      </div>

      <ul className="flex flex-col gap-3 md:gap-0 md:divide-y md:divide-neutral-200 md:rounded-lg md:border md:border-neutral-200 md:dark:divide-neutral-800 md:dark:border-neutral-800">
        <li
          aria-hidden
          className="hidden px-3 py-2 text-xs font-medium text-neutral-500 md:grid md:grid-cols-[2.75rem_3.5rem_minmax(0,1fr)_9rem_8rem_7rem_5rem] md:items-center md:gap-3"
        >
          <span />
          <span />
          <span>{t("columns.product")}</span>
          <span>{t("columns.price")}</span>
          <span>{t("columns.stock")}</span>
          <span>{t("columns.status")}</span>
          <span />
        </li>
        {items.map((item) => (
          <li
            key={item.id}
            data-product-row={item.id}
            className="grid grid-cols-[2.75rem_4rem_minmax(0,1fr)] gap-3 rounded-lg border border-neutral-200 p-3 md:grid-cols-[2.75rem_3.5rem_minmax(0,1fr)_9rem_8rem_7rem_5rem] md:items-center md:rounded-none md:border-0 dark:border-neutral-800"
          >
            <label className="flex size-11 items-center justify-center">
              <span className="sr-only">{t("selectRow", { title: item.title })}</span>
              <input
                type="checkbox"
                name="ids"
                value={item.id}
                form={BULK_FORM}
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
                className="size-5"
              />
            </label>
            {item.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element -- 400 px thumb
              <img src={item.thumb} alt="" className="size-16 rounded object-cover md:size-14" />
            ) : (
              <span className="size-16 rounded bg-neutral-100 md:size-14 dark:bg-neutral-800" aria-hidden />
            )}
            <div className="flex min-w-0 flex-col gap-1">
              <Link
                href={`/admin/products/${item.id}`}
                className="inline-flex min-h-11 items-center font-medium break-words hover:text-[var(--brand)]"
              >
                {item.title}
              </Link>
              <div className="flex flex-wrap items-center gap-2 text-xs md:hidden">
                <Price price={item.price} locale={locale} />
                <StatusChip status={item.status} label={ts(item.status)} />
                <StockNote item={item} />
              </div>
              {item.isFeatured ? (
                <span className="w-fit rounded bg-[var(--brand)] px-1.5 py-0.5 text-xs text-white">
                  {t("featuredBadge")}
                </span>
              ) : null}
            </div>
            <div className="hidden md:block">
              <Price price={item.price} locale={locale} />
            </div>
            <div className="hidden text-sm md:block">
              <StockNote item={item} />
            </div>
            <div className="hidden md:block">
              <StatusChip status={item.status} label={ts(item.status)} />
            </div>
            <Link
              href={`/admin/products/${item.id}`}
              className="hidden min-h-11 items-center justify-center rounded-md border border-neutral-300 px-3 text-sm md:inline-flex dark:border-neutral-700"
            >
              {t("edit")}
            </Link>
            <details className="col-span-3 md:col-span-7">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-neutral-600 dark:text-neutral-400">
                {t("showVariants")}
              </summary>
              <ul className="flex flex-col gap-2 pt-2">
                {item.variants.map((v) => (
                  <QuickStock key={v.id} variant={v} />
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>

      {/* Sticky bulk bar while something is selected. */}
      {selected.size > 0 ? (
        <div
          className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg md:bottom-4 dark:border-neutral-800 dark:bg-neutral-950"
          data-bulk-bar
        >
          <label className="flex flex-col gap-1 text-sm">
            {t("bulk.label")}
            <select
              name="action"
              form={BULK_FORM}
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              className={field}
              required
            >
              <option value="">{t("bulk.choose")}</option>
              {(["publish", "unpublish", "archive", "feature", "unfeature", "move", "delete"] as const).map(
                (a) => (
                  <option key={a} value={a}>
                    {t(`bulk.${a}`)}
                  </option>
                ),
              )}
            </select>
          </label>
          {bulk === "move" ? (
            <label className="flex flex-col gap-1 text-sm">
              {t("bulk.moveTo")}
              <select name="categoryId" form={BULK_FORM} className={field}>
                <option value="">{t("uncategorised")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.depth ? "— " : ""}
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="submit"
            form={BULK_FORM}
            disabled={!bulk}
            className="min-h-11 rounded-md bg-[var(--brand)] px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {t("bulk.apply")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Price({ price, locale }: { price: ListItem["price"]; locale: "bn" | "en" }) {
  if (!price) return <span className="text-neutral-400">—</span>;
  return (
    <span className="flex flex-wrap items-baseline gap-1">
      <span className={cn("font-semibold", price.regular !== null && "text-red-600 dark:text-red-400")}>
        {formatBDT(price.amount, locale)}
      </span>
      {price.regular !== null ? (
        <span className="text-xs text-neutral-400 line-through">{formatBDT(price.regular, locale)}</span>
      ) : null}
    </span>
  );
}

function StatusChip({ status, label }: { status: ListItem["status"]; label: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusStyle[status])}>{label}</span>
  );
}

function StockNote({ item }: { item: ListItem }) {
  const t = useTranslations("catalog.list");
  if (item.totalStock === 0)
    return <span className="font-medium text-red-600 dark:text-red-400">{t("outOfStock")}</span>;
  return (
    <span className={cn(item.totalStock <= LOW && "font-medium text-amber-700 dark:text-amber-300")}>
      {t("totalStock", { count: item.totalStock })}
    </span>
  );
}

/** − [n] + Save for one variant; STALE_UPDATE shows the latest value instead of overwriting. */
export function QuickStock({
  variant,
}: {
  variant: { id: string; label: string; stock: number; updatedAt: string };
}) {
  const t = useTranslations("catalog.list");
  const [state, action, pending] = useActionState(quickStockAction, null);
  const server = state?.data as { stock?: number; updatedAt?: string } | undefined;
  const base = { stock: server?.stock ?? variant.stock, updatedAt: server?.updatedAt ?? variant.updatedAt };
  // Re-seed the input whenever the server sends a new value (success or STALE_UPDATE).
  return (
    <li className="flex flex-col gap-1" data-quick-stock={variant.id}>
      <QuickStockForm
        key={`${base.updatedAt}:${base.stock}`}
        variant={variant}
        base={base}
        action={action}
        pending={pending}
      />
      {state ? <FormMessage state={state} /> : null}
      <span className="sr-only">{t("quickStock.label", { name: variant.label })}</span>
    </li>
  );
}

function QuickStockForm({
  variant,
  base,
  action,
  pending,
}: {
  variant: { id: string; label: string };
  base: { stock: number; updatedAt: string };
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const t = useTranslations("catalog.list");
  const [value, setValue] = useState(base.stock);
  const btn =
    "flex size-11 items-center justify-center rounded-md border border-neutral-300 text-lg dark:border-neutral-700";
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <span className="min-w-20 flex-1 text-sm">{variant.label}</span>
      <input type="hidden" name="variantId" value={variant.id} />
      <input type="hidden" name="expectedUpdatedAt" value={base.updatedAt} />
      <button
        type="button"
        className={btn}
        onClick={() => setValue((v) => Math.max(0, v - 1))}
        aria-label={t("quickStock.minus")}
      >
        −
      </button>
      <input
        name="stock"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(Number(e.target.value.replace(/\D/g, "")) || 0)}
        aria-label={t("quickStock.label", { name: variant.label })}
        className="h-11 w-20 rounded-md border border-neutral-300 bg-white px-2 text-center text-base dark:border-neutral-700 dark:bg-neutral-900"
      />
      <button
        type="button"
        className={btn}
        onClick={() => setValue((v) => v + 1)}
        aria-label={t("quickStock.plus")}
      >
        +
      </button>
      <button
        type="submit"
        disabled={pending || value === base.stock}
        className="min-h-11 rounded-md bg-[var(--brand)] px-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {t("quickStock.save")}
      </button>
    </form>
  );
}
