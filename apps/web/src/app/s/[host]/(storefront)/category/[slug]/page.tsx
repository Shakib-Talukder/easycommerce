import { STOREFRONT_SORTS, storefrontCategory, type StorefrontSort } from "@repo/core";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/storefront/product-grid";
import { getStoreForHost } from "@/lib/store";

type Props = {
  params: Promise<{ host: string; slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

async function load({ params, searchParams }: Props) {
  const { host, slug } = await params;
  const sp = await searchParams;
  const { store, settings } = await getStoreForHost(host);
  if (store.status !== "ACTIVE") return null;
  const sort = STOREFRONT_SORTS.includes(sp.sort as StorefrontSort) ? (sp.sort as StorefrontSort) : "newest";
  const page = Number(sp.page) > 0 ? Number(sp.page) : 1;
  const data = await storefrontCategory(store.id, slug, { sort, page });
  if (!data) notFound();
  return { data, sort, lang: settings.language };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const found = await load(props);
  if (!found) return {};
  const { category } = found.data;
  const lang = found.lang;
  return {
    title: lang === "en" ? category.nameEn : category.nameBn,
    description: (lang === "en" ? category.descriptionEn : category.descriptionBn) ?? undefined,
    ...(category.imageUrl ? { openGraph: { images: [{ url: category.imageUrl }] } } : {}),
  };
}

/** /category/[slug]: products in the category and its children, sort, pagination (24). */
export default async function CategoryPage(props: Props) {
  const found = await load(props);
  if (!found) return null;
  const { data, sort, lang } = found;
  const t = await getTranslations("storefront");
  const name = (c: { nameBn: string; nameEn: string }) => (lang === "en" ? c.nameEn : c.nameBn);
  const href = (p: number) =>
    `/category/${data.category.slug}?${new URLSearchParams({ sort, page: String(p) })}`;
  const btn =
    "inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700";

  return (
    <div className="flex flex-col gap-5">
      <nav
        aria-label={t("breadcrumb")}
        className="flex flex-wrap items-center gap-1 text-sm text-neutral-500"
      >
        <Link
          href="/"
          className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 hover:text-[var(--brand)]"
        >
          {t("home")}
        </Link>
        {data.parent ? (
          <>
            <span aria-hidden>/</span>
            <Link
              href={`/category/${data.parent.slug}`}
              className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 hover:text-[var(--brand)]"
            >
              {name(data.parent)}
            </Link>
          </>
        ) : null}
      </nav>
      <h1 className="text-2xl font-bold break-words">{name(data.category)}</h1>
      {data.children.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {data.children.map((c) => (
            <li key={c.id}>
              <Link href={`/category/${c.slug}`} className={`${btn} rounded-full`}>
                {name(c)}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-neutral-500" data-total={data.total}>
          {t("results", { total: data.total })}
        </p>
        {/* A GET form: sorting works without JavaScript. */}
        <form className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            {t("sortLabel")}
            <select
              name="sort"
              defaultValue={sort}
              className="h-11 rounded-md border border-neutral-300 bg-white px-3 text-base md:text-sm dark:border-neutral-700 dark:bg-neutral-900"
            >
              {STOREFRONT_SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sort.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={btn}>
            {t("applySort")}
          </button>
        </form>
      </div>

      {data.products.length === 0 ? (
        <p className="py-8 text-center text-neutral-500">{t("emptyCategory")}</p>
      ) : (
        <ProductGrid products={data.products} lang={lang} />
      )}

      {data.pages > 1 ? (
        <nav
          className="flex items-center justify-between gap-2"
          aria-label={t("page", { page: data.page, pages: data.pages })}
        >
          {data.page > 1 ? (
            <Link href={href(data.page - 1)} className={btn} rel="prev">
              {t("prev")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-neutral-500">
            {t("page", { page: data.page, pages: data.pages })}
          </span>
          {data.page < data.pages ? (
            <Link href={href(data.page + 1)} className={btn} rel="next">
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
