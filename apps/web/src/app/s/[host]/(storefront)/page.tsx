import { forStore, formatBDT } from "@repo/db";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getStoreForHost } from "@/lib/store";

export default async function StoreHome({ params }: { params: Promise<{ host: string }> }) {
  const { store, settings } = await getStoreForHost((await params).host);
  // The layout shows "coming soon" / "unavailable" instead.
  if (store.status !== "ACTIVE") return null;
  const lang = settings.language;
  const products = await forStore(store.id).product.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      slug: true,
      titleBn: true,
      titleEn: true,
      images: {
        orderBy: { sortOrder: "asc" },
        take: 1,
        select: { thumbUrl: true, altBn: true, altEn: true },
      },
      variants: { where: { deletedAt: null, isActive: true }, select: { price: true, salePrice: true } },
    },
  });

  if (products.length === 0) {
    return <p className="text-neutral-500">{(await getTranslations("storefront"))("noProducts")}</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => {
        const title = lang === "en" ? p.titleEn : p.titleBn;
        const cover = p.images[0];
        const prices = p.variants.map((v) => v.salePrice ?? v.price);
        const from = prices.length ? Math.min(...prices) : null;
        return (
          <li key={p.id}>
            <Link href={`/products/${p.slug}`} className="block h-full">
              <Card className="h-full overflow-hidden transition hover:shadow-md">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element -- immutable 400 px thumb
                  <img
                    src={cover.thumbUrl}
                    alt={(lang === "en" ? cover.altEn : cover.altBn) ?? title}
                    width={400}
                    height={400}
                    className="aspect-square w-full object-cover"
                  />
                ) : null}
                <CardHeader className="p-3">
                  <CardTitle className="text-base">{title}</CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  {from !== null ? (
                    <span className="font-semibold text-[var(--brand)]">{formatBDT(from, lang)}</span>
                  ) : null}
                </CardContent>
              </Card>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
