import type { ProductCardData } from "@repo/core";
import { formatBDT } from "@repo/db/money";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

/** Product cards (400 px thumbs): 2 columns on phones, up to 4 on desktop. */
export async function ProductGrid({ products, lang }: { products: ProductCardData[]; lang: "bn" | "en" }) {
  const t = await getTranslations("storefront");
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4" data-product-grid>
      {products.map((p) => {
        const title = lang === "en" ? p.titleEn : p.titleBn;
        return (
          <li key={p.id} data-product-card={p.slug}>
            <Link
              href={`/products/${p.slug}`}
              className="flex h-full flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white transition hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
            >
              <span className="relative block aspect-square bg-neutral-100 dark:bg-neutral-800">
                {p.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- immutable 400 px thumb
                  <img
                    src={p.thumbUrl}
                    alt={(lang === "en" ? p.altEn : p.altBn) ?? title}
                    width={400}
                    height={400}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : null}
                {p.regularPrice !== null ? (
                  <span className="absolute top-2 left-2 rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                    {t("onSale")}
                  </span>
                ) : null}
              </span>
              <span className="flex flex-1 flex-col gap-1 p-3">
                <span className="line-clamp-2 text-sm font-medium sm:text-base">{title}</span>
                {p.price !== null ? (
                  <span className="mt-auto flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={`font-semibold ${p.regularPrice !== null ? "text-red-600" : "text-[var(--brand)]"}`}
                    >
                      {formatBDT(p.price, lang)}
                    </span>
                    {p.regularPrice !== null ? (
                      <s className="text-xs text-neutral-400">{formatBDT(p.regularPrice, lang)}</s>
                    ) : null}
                  </span>
                ) : null}
                {!p.inStock ? (
                  <span className="text-xs font-medium text-neutral-500">{t("outOfStock")}</span>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
