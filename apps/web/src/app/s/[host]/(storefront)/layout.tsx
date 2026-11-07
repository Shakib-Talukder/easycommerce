import { storeDisplayName } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { getStoreForHost } from "@/lib/store";

type Props = { children: ReactNode; params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { store, settings } = await getStoreForHost((await params).host);
  const name = storeDisplayName(store, settings.language);
  // `absolute` keeps the platform's "· EasyCommerce" suffix off storefront pages.
  const title = { absolute: name, template: `%s · ${name}` };
  // Only a live store may be indexed.
  return store.status === "ACTIVE" ? { title } : { title, robots: { index: false, follow: false } };
}

export default async function StorefrontLayout({ children, params }: Props) {
  const { store, settings } = await getStoreForHost((await params).host);
  if (store.status === "PENDING") return <ComingSoon nameBn={store.nameBn} nameEn={store.nameEn} />;
  if (store.status === "SUSPENDED") return <StoreUnavailable />;
  const name = storeDisplayName(store, settings.language);
  const t = await getTranslations("storefront");

  return (
    <>
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <Link href="/" className="flex min-w-0 items-center gap-3 text-xl font-bold text-[var(--brand)]">
            {settings.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- immutable CDN/upload URL, already resized
              <img
                src={settings.logoUrl}
                alt=""
                width={40}
                height={40}
                className="size-10 rounded object-contain"
              />
            ) : null}
            <span className="truncate" data-store-name>
              {name}
            </span>
          </Link>
          {settings.contactPhone ? (
            <a
              href={`tel:${settings.contactPhone}`}
              className="shrink-0 text-sm text-neutral-600 dark:text-neutral-400"
            >
              {settings.contactPhone}
            </a>
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-neutral-200 py-6 text-center text-xs text-neutral-500 dark:border-neutral-800">
        {settings.address}
        {settings.codEnabled ? ` · ${t("cod")}` : null}
      </footer>
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
