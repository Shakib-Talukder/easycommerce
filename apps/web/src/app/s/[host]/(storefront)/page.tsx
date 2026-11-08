import { storefrontHome } from "@repo/core";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { ProductGrid } from "@/components/storefront/product-grid";
import { getStoreForHost } from "@/lib/store";

/** Store home: featured products (in featured order), categories, newest products. */
export default async function StoreHome({ params }: { params: Promise<{ host: string }> }) {
  const { store, settings } = await getStoreForHost((await params).host);
  // The layout shows "coming soon" / "unavailable" instead.
  if (store.status !== "ACTIVE") return null;
  const lang = settings.language;
  const [{ featured, newest, categories }, t] = await Promise.all([
    storefrontHome(store.id),
    getTranslations("storefront"),
  ]);

  if (featured.length === 0 && newest.length === 0) {
    return <p className="text-neutral-500">{t("noProducts")}</p>;
  }

  return (
    <div className="flex flex-col gap-10">
      {featured.length > 0 ? (
        <Section title={t("featured")} id="featured">
          <ProductGrid products={featured} lang={lang} />
        </Section>
      ) : null}

      {categories.length > 0 ? (
        <Section title={t("categoriesTitle")} id="categories">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-category-list>
            {categories.map((c) => {
              const name = lang === "en" ? c.nameEn : c.nameBn;
              return (
                <li key={c.id}>
                  <Link
                    href={`/category/${c.slug}`}
                    className="flex h-full flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
                    data-category-link={c.slug}
                  >
                    <span className="block aspect-[4/3] bg-neutral-100 dark:bg-neutral-800">
                      {c.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- 800 px category image
                        <img src={c.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
                      ) : null}
                    </span>
                    <span className="flex min-h-11 items-center px-3 py-2 font-medium">{name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {newest.length > 0 ? (
        <Section title={t("newest")} id="newest">
          <ProductGrid products={newest} lang={lang} />
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby={`${id}-title`} data-section={id}>
      <h2 id={`${id}-title`} className="text-xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}
