import { forStore, formatBDT } from "@repo/db";
import { Button } from "@repo/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getStoreForHost } from "@/lib/store";

type Props = { params: Promise<{ host: string; slug: string }> };

async function getProduct(host: string, slug: string) {
  const { store, settings } = await getStoreForHost(host);
  // Not live: the layout shows "coming soon" / "unavailable" instead.
  if (store.status !== "ACTIVE") return null;
  const product = await forStore(store.id).product.findFirst({
    where: { slug, status: "ACTIVE", deletedAt: null },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      variants: { where: { deletedAt: null, isActive: true }, orderBy: { price: "asc" } },
    },
  });
  if (!product) notFound();
  return { product, lang: settings.language };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { host, slug } = await params;
  const found = await getProduct(host, slug);
  if (!found) return {};
  const { product, lang } = found;
  return {
    title: lang === "en" ? product.titleEn : product.titleBn,
    description: (lang === "en" ? product.descriptionEn : product.descriptionBn) ?? undefined,
  };
}

export default async function ProductPage({ params }: Props) {
  const { host, slug } = await params;
  const found = await getProduct(host, slug);
  if (!found) return null;
  const { product, lang } = found;
  const t = await getTranslations("storefront");
  const title = lang === "en" ? product.titleEn : product.titleBn;
  const description = lang === "en" ? product.descriptionEn : product.descriptionBn;
  const cover = product.images[0];
  const cheapest = product.variants[0];

  return (
    <article className="grid gap-8 md:grid-cols-2">
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element -- immutable 1600 px WebP
        <img
          src={cover.url}
          alt={(lang === "en" ? cover.altEn : cover.altBn) ?? title}
          width={cover.width}
          height={cover.height}
          className="aspect-square w-full rounded-xl object-cover"
        />
      ) : null}
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold">{title}</h1>
        {cheapest ? (
          <p className="text-2xl font-semibold text-[var(--brand)]">
            {formatBDT(cheapest.salePrice ?? cheapest.price, lang)}
          </p>
        ) : null}
        {description ? (
          <p className="whitespace-pre-line text-neutral-600 dark:text-neutral-400">{description}</p>
        ) : null}
        <p className="text-sm text-neutral-500">
          {product.variants.some((v) => v.stock > 0) ? null : t("soldOut")}
        </p>
        <Button size="lg" disabled>
          {t("orderSoon")}
        </Button>
      </div>
    </article>
  );
}
