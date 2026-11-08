import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { CatalogNav, PageHeader, secondaryLink } from "@/components/catalog/catalog-nav";
import { ProductEditor } from "@/components/catalog/product-editor";
import { requirePermission } from "@/server/auth";
import { categorySelectOptions } from "@/server/catalog";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("catalog.editor"))("metaNew") };
}

/** Photos are added after the first save (they need the product id). */
export default async function NewProductPage() {
  const { store } = await requirePermission("catalog:manage");
  const locale = (await getLocale()) as "bn" | "en";
  const [t, ti, categories] = await Promise.all([
    getTranslations("catalog.editor"),
    getTranslations("catalog.images"),
    categorySelectOptions(store.id, locale),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <CatalogNav active="products" />
      <PageHeader title={t("newTitle")}>
        <Link href="/admin/products" className={secondaryLink}>
          {t("back")}
        </Link>
      </PageHeader>
      <p className="text-sm text-neutral-500">{ti("saveFirst")}</p>
      <ProductEditor product={null} categories={categories} />
    </div>
  );
}
