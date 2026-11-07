import { forStore } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { getStoreForHost } from "@/lib/store";

type Props = { children: ReactNode; params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const store = await getStoreForHost((await params).host);
  // `absolute` keeps the platform's "· EasyCommerce" suffix off storefront pages.
  return { title: { absolute: store.name, template: `%s · ${store.name}` } };
}

export default async function StoreLayout({ children, params }: Props) {
  const store = await getStoreForHost((await params).host);
  const settings = await forStore(store.id).storeSettings.findUnique({ where: { storeId: store.id } });

  return (
    <div
      lang={settings?.language ?? "bn"}
      style={{ "--brand": settings?.primaryColor ?? "#16a34a" } as CSSProperties}
      className="flex min-h-dvh flex-col"
    >
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-xl font-bold text-[var(--brand)]">
            {store.name}
          </Link>
          {settings?.contactPhone ? (
            <a
              href={`tel:${settings.contactPhone}`}
              className="text-sm text-neutral-600 dark:text-neutral-400"
            >
              {settings.contactPhone}
            </a>
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-neutral-200 py-6 text-center text-xs text-neutral-500 dark:border-neutral-800">
        {settings?.address}
        {settings?.codEnabled ? " · ক্যাশ অন ডেলিভারি" : null}
      </footer>
    </div>
  );
}
