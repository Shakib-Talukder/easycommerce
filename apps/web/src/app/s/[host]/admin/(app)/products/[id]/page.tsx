import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogNav, PageHeader, secondaryLink } from "@/components/catalog/catalog-nav";
import { ConfirmButton } from "@/components/catalog/confirm-button";
import { ProductEditor } from "@/components/catalog/product-editor";
import { duplicateProductAction, trashProductAction } from "@/server/actions/catalog";
import { requirePermission } from "@/server/auth";
import { categorySelectOptions, loadEditorProduct } from "@/server/catalog";
import { getErrorTranslator } from "@/server/i18n";
import { requestProtocol } from "@/server/request";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("catalog.editor"))("editTitle") };
}

export default async function EditProductPage({ params, searchParams }: Props) {
  const { store } = await requirePermission("catalog:manage");
  const { id } = await params;
  const sp = await searchParams;
  const locale = (await getLocale()) as "bn" | "en";
  const [product, categories, t, te] = await Promise.all([
    loadEditorProduct(store.id, id),
    categorySelectOptions(store.id, locale),
    getTranslations("catalog.editor"),
    getErrorTranslator(),
  ]);
  if (!product) notFound();
  const storeUrl = `${await requestProtocol()}://${store.subdomain}.${process.env.ROOT_DOMAIN ?? "localhost:3000"}`;
  const notice = sp.saved ? t("saved") : sp.duplicated ? t("duplicated") : null;

  return (
    <div className="flex flex-col gap-4">
      <CatalogNav active="products" />
      <PageHeader title={locale === "en" ? product.titleEn : product.titleBn}>
        <Link href="/admin/products" className={secondaryLink}>
          {t("back")}
        </Link>
        {product.status === "ACTIVE" ? (
          <a
            href={`${storeUrl}/products/${product.slug}`}
            target="_blank"
            rel="noreferrer"
            className={secondaryLink}
          >
            {t("viewInStore")}
          </a>
        ) : null}
        <form action={duplicateProductAction}>
          <input type="hidden" name="productId" value={product.id} />
          <button type="submit" className={secondaryLink} data-duplicate>
            {t("duplicate")}
          </button>
        </form>
        <ConfirmButton
          action={trashProductAction}
          fields={{ productId: product.id }}
          label={t("moveToTrash")}
          question={t("trashConfirm")}
          yes={t("yesTrash")}
          no={t("cancel")}
          testId="trash"
        />
      </PageHeader>
      {notice ? (
        <p
          role="status"
          data-toast
          className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200"
        >
          {notice}
        </p>
      ) : null}
      {sp.error ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {te(sp.error)}
        </p>
      ) : null}
      {/* key: a fresh editor after every save (new variant ids and updatedAt). */}
      <ProductEditor
        key={JSON.stringify(product.variants.map((v) => [v.id, v.stock, v.price]))}
        product={product}
        categories={categories}
      />
    </div>
  );
}
