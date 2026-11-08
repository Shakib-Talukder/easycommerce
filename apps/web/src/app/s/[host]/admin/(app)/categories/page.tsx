import { listCategoryTree, type CategoryNode } from "@repo/core";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CatalogNav, PageHeader } from "@/components/catalog/catalog-nav";
import { CategoryForm, CategoryImage, DeleteCategory } from "@/components/catalog/category-forms";
import { moveCategoryAction, removeCategoryImageAction } from "@/server/actions/catalog";
import { requirePermission } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("catalog.categories"))("metaTitle") };
}

const btn =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-neutral-300 px-3 text-sm disabled:opacity-40 dark:border-neutral-700";

/** /admin/categories: the tree (parent → children), add/edit, image, up/down, delete. */
export default async function CategoriesPage() {
  const { store } = await requirePermission("catalog:manage");
  const locale = (await getLocale()) as "bn" | "en";
  const [tree, t] = await Promise.all([listCategoryTree(store.id), getTranslations("catalog.categories")]);
  const parents = tree.map((c) => ({ id: c.id, nameBn: c.nameBn, nameEn: c.nameEn }));

  const Node = ({
    c,
    i,
    siblings,
    child,
  }: {
    c: CategoryNode;
    i: number;
    siblings: number;
    child?: boolean;
  }) => (
    <li
      data-category={c.slug}
      className={
        child
          ? "flex flex-col gap-2 border-l-2 border-neutral-200 py-2 pl-3 dark:border-neutral-800"
          : "flex flex-col gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        {c.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 800 px category image
          <img src={c.imageUrl} alt="" className="size-10 rounded object-cover" />
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium break-words">{locale === "en" ? c.nameEn : c.nameBn}</span>
          <span className="text-xs text-neutral-500">
            {t("products", { count: c.productCount })}
            {c.isActive ? "" : ` · ${t("hidden")}`}
          </span>
        </span>
        <span className="flex gap-2">
          <form action={moveCategoryAction}>
            <input type="hidden" name="categoryId" value={c.id} />
            <input type="hidden" name="direction" value="up" />
            <button className={btn} disabled={i === 0} aria-label={t("moveUp")}>
              ↑
            </button>
          </form>
          <form action={moveCategoryAction}>
            <input type="hidden" name="categoryId" value={c.id} />
            <input type="hidden" name="direction" value="down" />
            <button className={btn} disabled={i === siblings - 1} aria-label={t("moveDown")}>
              ↓
            </button>
          </form>
        </span>
      </div>
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center text-sm text-[var(--brand)]">
          {t("edit")}
        </summary>
        <div className="flex flex-col gap-4 pt-2">
          <CategoryForm
            values={{
              id: c.id,
              nameBn: c.nameBn,
              nameEn: c.nameEn,
              descriptionBn: c.descriptionBn ?? "",
              descriptionEn: c.descriptionEn ?? "",
              parentId: c.parentId ?? "",
              isActive: c.isActive,
              slug: c.slug,
            }}
            parents={c.children.length ? [] : parents}
          />
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{t("image")}</p>
            <CategoryImage id={c.id} url={c.imageUrl} />
            {c.imageUrl ? (
              <form action={removeCategoryImageAction}>
                <input type="hidden" name="categoryId" value={c.id} />
                <button className={btn}>{t("removeImage")}</button>
              </form>
            ) : null}
          </div>
          <DeleteCategory id={c.id} productCount={c.productCount} />
        </div>
      </details>
      {c.children.length ? (
        <ul className="flex flex-col gap-1">
          {c.children.map((k, j) => (
            <Node key={k.id} c={k} i={j} siblings={c.children.length} child />
          ))}
        </ul>
      ) : null}
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <CatalogNav active="categories" />
      <PageHeader title={t("title")} />
      <p className="text-sm text-neutral-500">{t("hint")}</p>
      {tree.length === 0 ? <p className="text-neutral-500">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-3" data-category-tree>
        {tree.map((c, i) => (
          <Node key={c.id} c={c} i={i} siblings={tree.length} />
        ))}
      </ul>
      <section className="flex flex-col gap-3 rounded-xl border border-dashed border-neutral-300 p-4 dark:border-neutral-700">
        <h2 className="text-lg font-semibold">{t("add")}</h2>
        <CategoryForm
          values={{
            nameBn: "",
            nameEn: "",
            descriptionBn: "",
            descriptionEn: "",
            parentId: "",
            isActive: true,
          }}
          parents={parents}
        />
      </section>
    </div>
  );
}
