import { forStore, formatBDT } from "@repo/db";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getStoreForHost } from "@/lib/store";

type ProductImage = { url: string; alt?: string };

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }): Promise<Metadata> {
  const store = await getStoreForHost((await params).host);
  return { title: { absolute: store.name } };
}

export default async function StoreHome({ params }: { params: Promise<{ host: string }> }) {
  const store = await getStoreForHost((await params).host);
  const db = forStore(store.id);
  const [settings, products] = await Promise.all([
    db.storeSettings.findUnique({ where: { storeId: store.id }, select: { language: true } }),
    db.product.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, slug: true, images: true, basePrice: true, compareAtPrice: true },
    }),
  ]);
  const lang = settings?.language ?? "bn";

  if (products.length === 0) {
    return <p className="text-neutral-500">{lang === "bn" ? "এখনো কোনো পণ্য নেই।" : "No products yet."}</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => {
        const image = (p.images as ProductImage[])[0];
        return (
          <li key={p.id}>
            <Link href={`/products/${p.slug}`} className="block h-full">
              <Card className="h-full overflow-hidden transition hover:shadow-md">
                {image ? (
                  <Image
                    src={image.url}
                    alt={image.alt ?? p.title}
                    width={400}
                    height={400}
                    className="aspect-square w-full object-cover"
                  />
                ) : null}
                <CardHeader className="p-3">
                  <CardTitle className="text-base">{p.title}</CardTitle>
                </CardHeader>
                <CardContent className="flex items-baseline gap-2 p-3 pt-0">
                  <span className="font-semibold text-[var(--brand)]">{formatBDT(p.basePrice, lang)}</span>
                  {p.compareAtPrice ? (
                    <span className="text-xs text-neutral-400 line-through">
                      {formatBDT(p.compareAtPrice, lang)}
                    </span>
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
