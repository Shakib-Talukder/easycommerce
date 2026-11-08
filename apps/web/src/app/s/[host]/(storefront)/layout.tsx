import { readSeo } from "@repo/core";
import { storeDisplayName } from "@repo/db";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { StoreFooter, StoreHeader, taglineOf } from "@/components/storefront-chrome";
import { getTranslations } from "next-intl/server";
import { getStoreForHost } from "@/lib/store";
import { requestProtocol } from "@/server/request";

type Props = { children: ReactNode; params: Promise<{ host: string }> };

/**
 * <title>, meta description and Open Graph in the store's language, from the
 * Social & SEO settings (falling back to the store name and tagline).
 */
export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const encoded = (await params).host;
  const { store, settings } = await getStoreForHost(encoded);
  const lang = settings.language;
  const name = storeDisplayName(store, lang);
  const seo = readSeo(settings.seo);
  const pick = (bn?: string, en?: string) => (lang === "en" ? (en ?? bn) : (bn ?? en));
  const title = pick(seo.titleBn, seo.titleEn) ?? name;
  const description = pick(seo.descriptionBn, seo.descriptionEn) ?? taglineOf(settings) ?? undefined;
  const base = new URL(`${await requestProtocol()}://${decodeURIComponent(encoded)}`);
  const image = settings.logoUrl ? new URL(settings.logoUrl, base).toString() : undefined;

  const metadata: Metadata = {
    metadataBase: base,
    // `absolute` keeps the platform's "· EasyCommerce" suffix off storefront pages.
    title: { absolute: title, template: `%s · ${name}` },
    description,
    openGraph: {
      type: "website",
      siteName: name,
      title,
      description,
      url: base.toString(),
      locale: lang === "en" ? "en_US" : "bn_BD",
      ...(image ? { images: [{ url: image, alt: name }] } : {}),
    },
    twitter: { card: "summary", title, description, ...(image ? { images: [image] } : {}) },
  };
  // Only a live store may be indexed.
  return store.status === "ACTIVE" ? metadata : { ...metadata, robots: { index: false, follow: false } };
}

export default async function StorefrontLayout({ children, params }: Props) {
  const { store, settings } = await getStoreForHost((await params).host);
  if (store.status === "PENDING") return <ComingSoon nameBn={store.nameBn} nameEn={store.nameEn} />;
  if (store.status === "SUSPENDED") return <StoreUnavailable />;

  return (
    <>
      <StoreHeader store={store} settings={settings} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <StoreFooter store={store} settings={settings} />
    </>
  );
}

const bilingual = () =>
  Promise.all([
    getTranslations({ locale: "bn", namespace: "storefront" }),
    getTranslations({ locale: "en", namespace: "storefront" }),
  ]);

/** Bilingual on purpose: visitors arrive before the store has chosen a language. */
async function ComingSoon({ nameBn, nameEn }: { nameBn: string; nameEn: string }) {
  const [bn, en] = await bilingual();
  return (
    <main
      data-store-status="coming-soon"
      className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center"
    >
      <p className="text-sm font-medium tracking-wide text-[var(--brand)] uppercase">
        {bn("comingSoon")} · {en("comingSoon")}
      </p>
      <h1 className="text-3xl font-bold">{nameBn}</h1>
      {nameEn !== nameBn ? <p className="text-xl text-neutral-600 dark:text-neutral-400">{nameEn}</p> : null}
      <p className="max-w-md text-neutral-500" lang="bn">
        {bn("comingSoonBody")}
      </p>
      <p className="max-w-md text-neutral-500" lang="en">
        {en("comingSoonBody")}
      </p>
    </main>
  );
}

async function StoreUnavailable() {
  const [bn, en] = await bilingual();
  return (
    <main
      data-store-status="unavailable"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center"
    >
      <h1 className="text-2xl font-bold">
        {bn("unavailable")} / {en("unavailable")}
      </h1>
    </main>
  );
}
