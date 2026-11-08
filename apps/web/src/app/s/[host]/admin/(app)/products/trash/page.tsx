import { can, listTrash } from "@repo/core";
import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { CatalogNav, PageHeader } from "@/components/catalog/catalog-nav";
import { ConfirmButton } from "@/components/catalog/confirm-button";
import { permanentDeleteAction, restoreProductsAction } from "@/server/actions/catalog";
import { requirePermission } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("catalog.trash"))("metaTitle") };
}

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-4 text-sm font-medium dark:border-neutral-700";

/** /admin/products/trash: restore (OWNER and STAFF), delete for good (OWNER only). */
export default async function TrashPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { store, user } = await requirePermission("catalog:manage");
  const sp = await searchParams;
  const locale = (await getLocale()) as "bn" | "en";
  const [rows, t, format] = await Promise.all([
    listTrash(store.id),
    getTranslations("catalog.trash"),
    getFormatter(),
  ]);
  const owner = can(user.role, "catalog:delete");

  return (
    <div className="flex flex-col gap-4">
      <CatalogNav active="trash" />
      <PageHeader title={t("title")} />
      <p className="text-sm text-neutral-500">{t("hint")}</p>
      {sp.restored || sp.deleted ? (
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200"
        >
          {sp.restored ? t("restored") : t("deleted")}
        </p>
      ) : null}
      {!owner ? <p className="text-sm text-neutral-500">{t("ownerOnly")}</p> : null}
      {rows.length === 0 ? <p className="text-neutral-500">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-2">
        {rows.map((p) => {
          const title = locale === "en" ? p.titleEn : p.titleBn;
          return (
            <li
              key={p.id}
              data-trashed={p.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
            >
              {p.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element -- 400 px thumb
                <img src={p.images[0].thumbUrl} alt="" className="size-12 rounded object-cover" />
              ) : null}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium break-words">{title}</span>
                <span className="text-xs text-neutral-500">
                  {t("deletedOn", {
                    date: format.dateTime(p.deletedAt!, { dateStyle: "medium", timeStyle: "short" }),
                  })}
                </span>
              </span>
              <form action={restoreProductsAction}>
                <input type="hidden" name="ids" value={p.id} />
                <button className={btn} data-restore>
                  {t("restore")}
                </button>
              </form>
              {owner ? (
                <ConfirmButton
                  action={permanentDeleteAction}
                  fields={{ ids: p.id }}
                  label={t("deletePermanently")}
                  question={t("confirm", { title })}
                  yes={t("yesDelete")}
                  no={t("keep")}
                  testId="permanent-delete"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
