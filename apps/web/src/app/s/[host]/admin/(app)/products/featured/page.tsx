import { featuredCandidates, listFeatured } from "@repo/core";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CatalogNav, PageHeader } from "@/components/catalog/catalog-nav";
import { AddFeaturedForm } from "@/components/catalog/featured-forms";
import { moveFeaturedAction, removeFeaturedAction } from "@/server/actions/catalog";
import { requirePermission } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("catalog.featured"))("metaTitle") };
}

const btn =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-neutral-300 px-3 text-sm disabled:opacity-40 dark:border-neutral-700";

/** /admin/products/featured: ordered list (home page order), add/remove, up/down, 12-item limit. */
export default async function FeaturedPage() {
  const { store } = await requirePermission("catalog:manage");
  const locale = (await getLocale()) as "bn" | "en";
  const [{ rows, max }, candidates, t, ts] = await Promise.all([
    listFeatured(store.id),
    featuredCandidates(store.id),
    getTranslations("catalog.featured"),
    getTranslations("catalog.status"),
  ]);
  const title = (p: { titleBn: string; titleEn: string }) => (locale === "en" ? p.titleEn : p.titleBn);

  return (
    <div className="flex flex-col gap-4">
      <CatalogNav active="featured" />
      <PageHeader title={t("title")} />
      <p className="text-sm text-neutral-500">
        {t("hint")}{" "}
        <strong data-featured-count={rows.length}>{t("count", { count: rows.length, max })}</strong>
      </p>
      {rows.length >= max ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">{t("limitReached", { max })}</p>
      ) : null}
      {rows.length === 0 ? <p className="text-neutral-500">{t("empty")}</p> : null}
      <ol className="flex flex-col gap-2" data-featured-list>
        {rows.map((p, i) => (
          <li
            key={p.id}
            data-featured={p.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <span className="w-6 text-center text-sm text-neutral-500">{i + 1}</span>
            {p.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element -- 400 px thumb
              <img src={p.images[0].thumbUrl} alt="" className="size-12 rounded object-cover" />
            ) : null}
            <span className="min-w-0 flex-1 font-medium break-words">
              {title(p)}
              {p.status !== "ACTIVE" ? (
                <span className="ml-2 text-xs text-neutral-500">({ts(p.status)})</span>
              ) : null}
            </span>
            <span className="flex gap-2">
              <form action={moveFeaturedAction}>
                <input type="hidden" name="productId" value={p.id} />
                <input type="hidden" name="direction" value="up" />
                <button className={btn} disabled={i === 0} aria-label={t("moveUp")}>
                  ↑
                </button>
              </form>
              <form action={moveFeaturedAction}>
                <input type="hidden" name="productId" value={p.id} />
                <input type="hidden" name="direction" value="down" />
                <button className={btn} disabled={i === rows.length - 1} aria-label={t("moveDown")}>
                  ↓
                </button>
              </form>
              <form action={removeFeaturedAction}>
                <input type="hidden" name="productId" value={p.id} />
                <button className={btn}>{t("remove")}</button>
              </form>
            </span>
          </li>
        ))}
      </ol>
      {rows.length < max ? (
        <AddFeaturedForm
          options={candidates.map((c) => ({
            id: c.id,
            label: `${title(c)}${c.status !== "ACTIVE" ? ` (${ts(c.status)})` : ""}`,
          }))}
        />
      ) : null}
    </div>
  );
}
