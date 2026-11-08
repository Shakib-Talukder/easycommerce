import { storefrontProduct } from "@repo/core";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductView } from "@/components/storefront/product-view";
import { getStoreForHost } from "@/lib/store";
import { requestProtocol } from "@/server/request";

type Props = { params: Promise<{ host: string; slug: string }> };

async function getProduct(host: string, slug: string) {
  const { store, settings } = await getStoreForHost(host);
  // Not live: the layout shows "coming soon" / "unavailable" instead.
  if (store.status !== "ACTIVE") return null;
  // Only ACTIVE, non-deleted products: DRAFT, ARCHIVED and trashed ones are 404.
  const product = await storefrontProduct(store.id, slug);
  if (!product) notFound();
  return { product, lang: settings.language };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { host, slug } = await params;
  const found = await getProduct(host, slug);
  if (!found) return {};
  const { product, lang } = found;
  const title = lang === "en" ? product.titleEn : product.titleBn;
  const description =
    (lang === "en" ? product.descriptionEn : product.descriptionBn)?.slice(0, 160) ?? undefined;
  const base = `${await requestProtocol()}://${decodeURIComponent(host)}`;
  const cover = product.images[0];
  return {
    title,
    description,
    alternates: { canonical: `${base}/products/${product.slug}` },
    openGraph: {
      type: "website",
      title,
      description,
      url: `${base}/products/${product.slug}`,
      ...(cover
        ? {
            images: [
              {
                url: new URL(cover.url, base).toString(),
                width: cover.width,
                height: cover.height,
                alt: title,
              },
            ],
          }
        : {}),
    },
    twitter: { card: cover ? "summary_large_image" : "summary", title, description },
  };
}

export default async function ProductPage({ params }: Props) {
  const { host, slug } = await params;
  const found = await getProduct(host, slug);
  if (!found) return null;
  const { product, lang } = found;
  const t = await getTranslations("storefront");
  const title = lang === "en" ? product.titleEn : product.titleBn;

  return (
    <article className="flex flex-col gap-4" data-product={product.slug}>
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
        {product.category ? (
          <>
            <span aria-hidden>/</span>
            <Link
              href={`/category/${product.category.slug}`}
              className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 hover:text-[var(--brand)]"
            >
              {lang === "en" ? product.category.nameEn : product.category.nameBn}
            </Link>
          </>
        ) : null}
      </nav>
      <ProductView
        title={title}
        description={lang === "en" ? product.descriptionEn : product.descriptionBn}
        lang={lang}
        axes={product.options}
        variants={product.variants}
        images={product.images.map((i) => ({
          id: i.id,
          url: i.url,
          thumbUrl: i.thumbUrl,
          width: i.width,
          height: i.height,
          alt: (lang === "en" ? i.altEn : i.altBn) ?? "",
        }))}
      />
    </article>
  );
}
