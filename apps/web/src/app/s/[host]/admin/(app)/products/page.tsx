import {
  PRODUCT_SORTS,
  STOCK_FILTERS,
  categoryOptions,
  combinationLabel,
  listProducts,
  type ProductFilters,
} from "@repo/core";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { CatalogNav, PageHeader, primaryLink, secondaryLink } from "@/components/catalog/catalog-nav";
import { ProductList, type ListItem } from "@/components/catalog/product-list";
import { requirePermission } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("catalog.list"))("metaTitle") };
}

type Search = Record<string, string | undefined>;

function parseFilters(sp: Search, locale: "bn" | "en"): ProductFilters {
  const pick = <T extends string>(v: string | undefined, allowed: readonly T[]) =>
    allowed.includes(v as T) ? (v as T) : undefined;
  return {
    q: sp.q?.slice(0, 100) || undefined,
    status: pick(sp.status, ["DRAFT", "ACTIVE", "ARCHIVED"] as const),
    categoryId: sp.category || undefined,
    featured: sp.featured === "yes" ? true : sp.featured === "no" ? false : undefined,
    stock: pick(sp.stock, STOCK_FILTERS),
    sort: pick(sp.sort, PRODUCT_SORTS) ?? "newest",
    page: Number(sp.page) > 0 ? Number(sp.page) : 1,
    locale,
  };
}

/** /admin/products: search, filters, sort, pagination (20), bulk actions, quick stock. */
export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { store } = await requirePermission("catalog:manage");
  const locale = (await getLocale()) as "bn" | "en";
  const sp = await searchParams;
  const filters = parseFilters(sp, locale);
  const [{ rows, total, page, pages }, categories, t, tc] = await Promise.all([
    listProducts(store.id, filters),
    categoryOptions(store.id),
    getTranslations("catalog.list"),
    getTranslations("catalog"),
  ]);

  const items: ListItem[] = rows.map((r) => ({
    id: r.id,
    title: locale === "en" ? r.titleEn : r.titleBn,
    status: r.status,
    isFeatured: r.isFeatured,
    thumb: r.coverThumbUrl,
    price: r.price,
    totalStock: r.totalStock,
    variants: r.variants
      .filter((v) => v.isActive)
      .map((v) => ({
        id: v.id,
        label: combinationLabel(r.options, v.optionValues, locale) || tc("editor.default"),
        stock: v.stock,
        updatedAt: v.updatedAt.toISOString(),
      })),
  }));
  const hasFilters = Boolean(sp.q || sp.status || sp.category || sp.featured || sp.stock);
  const pageHref = (p: number) => `/admin/products?${new URLSearchParams({ ...clean(sp), page: String(p) })}`;
  const select =
    "h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-base sm:text-sm dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <div className="flex flex-col gap-4">
      <CatalogNav active="products" />
      <PageHeader title={t("title")}>
        <Link href="/admin/products/new" className={primaryLink} data-new-product>
          {tc("nav.newProduct")}
        </Link>
      </PageHeader>
      {sp.trashed ? (
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200"
        >
          {t("trashed")}
        </p>
      ) : null}

      {/* A GET form: filters live in the URL and work without JavaScript. */}
      <form className="flex flex-col gap-3" role="search">
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="product-search">
            {t("search")}
          </label>
          <input
            id="product-search"
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder={t("search")}
            className={select}
          />
          <button type="submit" className={primaryLink}>
            {t("searchButton")}
          </button>
        </div>
        <details className="rounded-md border border-neutral-200 dark:border-neutral-800" open={hasFilters}>
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">
            {t("filters")}
          </summary>
          <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="flex flex-col gap-1 text-sm">
              {t("statusLabel")}
              <select name="status" defaultValue={filters.status ?? ""} className={select}>
                <option value="">{t("all")}</option>
                {(["ACTIVE", "DRAFT", "ARCHIVED"] as const).map((s) => (
                  <option key={s} value={s}>
                    {tc(`status.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("categoryLabel")}
              <select name="category" defaultValue={filters.categoryId ?? ""} className={select}>
                <option value="">{t("all")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.depth ? "— " : ""}
                    {locale === "en" ? c.nameEn : c.nameBn}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("featuredLabel")}
              <select name="featured" defaultValue={sp.featured ?? ""} className={select}>
                <option value="">{t("all")}</option>
                <option value="yes">{t("featuredYes")}</option>
                <option value="no">{t("featuredNo")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("stockLabel")}
              <select name="stock" defaultValue={filters.stock ?? ""} className={select}>
                <option value="">{t("all")}</option>
                {STOCK_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {t(`stock.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("sortLabel")}
              <select name="sort" defaultValue={filters.sort} className={select}>
                {PRODUCT_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`sort.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-5">
              <button type="submit" className={primaryLink}>
                {t("apply")}
              </button>
              {hasFilters ? (
                <Link href="/admin/products" className={secondaryLink}>
                  {t("reset")}
                </Link>
              ) : null}
            </div>
          </div>
        </details>
      </form>

      <p className="text-sm text-neutral-500" data-total={total}>
        {t("results", { total })}
      </p>
      {items.length === 0 ? (
        <p className="py-8 text-center text-neutral-500">{hasFilters ? t("empty") : t("emptyStore")}</p>
      ) : (
        <ProductList
          items={items}
          categories={categories.map((c) => ({
            id: c.id,
            depth: c.depth,
            name: locale === "en" ? c.nameEn : c.nameBn,
          }))}
        />
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-between gap-2" aria-label={t("page", { page, pages })}>
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className={secondaryLink} rel="prev">
              {t("prev")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-neutral-500">{t("page", { page, pages })}</span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className={secondaryLink} rel="next">
              {t("next")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}

function clean(sp: Search): Record<string, string> {
  return Object.fromEntries(
    Object.entries(sp).filter(
      (e): e is [string, string] =>
        typeof e[1] === "string" && e[1] !== "" && !["page", "trashed"].includes(e[0]),
    ),
  );
}
