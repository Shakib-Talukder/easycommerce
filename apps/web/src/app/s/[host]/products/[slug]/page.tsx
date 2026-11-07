import { forStore, formatBDT } from "@repo/db";
import { Button } from "@repo/ui";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getStoreForHost } from "@/lib/store";

type Props = { params: Promise<{ host: string; slug: string }> };
type ProductImage = { url: string; alt?: string };

async function getProduct(host: string, slug: string) {
  const store = await getStoreForHost(host);
  const db = forStore(store.id);
  const [settings, product] = await Promise.all([
    db.storeSettings.findUnique({ where: { storeId: store.id }, select: { language: true } }),
    db.product.findFirst({
      where: { slug, status: "ACTIVE", deletedAt: null },
      include: { variants: { where: { deletedAt: null }, orderBy: { price: "asc" } } },
    }),
  ]);
  if (!product) notFound();
  return { product, lang: settings?.language ?? "bn" };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { host, slug } = await params;
  const { product } = await getProduct(host, slug);
  return { title: product.title, description: product.description ?? undefined };
}

export default async function ProductPage({ params }: Props) {
  const { host, slug } = await params;
  const { product, lang } = await getProduct(host, slug);
  const image = (product.images as ProductImage[])[0];

  return (
    <article className="grid gap-8 md:grid-cols-2">
      {image ? (
        <Image
          src={image.url}
          alt={image.alt ?? product.title}
          width={800}
          height={800}
          className="aspect-square w-full rounded-xl object-cover"
          priority
        />
      ) : null}
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold">{product.title}</h1>
        <p className="text-2xl font-semibold text-[var(--brand)]">{formatBDT(product.basePrice, lang)}</p>
        {product.description ? (
          <p className="text-neutral-600 dark:text-neutral-400">{product.description}</p>
        ) : null}

        {product.variants.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {product.variants.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800"
              >
                <span>{v.title}</span>
                <span className="text-sm">
                  {formatBDT(v.price, lang)}
                  <span className="ml-2 text-neutral-500">
                    {v.stock > 0
                      ? lang === "bn"
                        ? `স্টকে ${v.stock}`
                        : `${v.stock} in stock`
                      : lang === "bn"
                        ? "স্টক শেষ"
                        : "Sold out"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <Button size="lg" disabled>
          {lang === "bn" ? "অর্ডার করুন (শীঘ্রই)" : "Order now (coming soon)"}
        </Button>
      </div>
    </article>
  );
}
