import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { getStoreForHost } from "@/lib/store";

type Props = { children: ReactNode; params: Promise<{ host: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Admin for ACTIVE and PENDING stores; a SUSPENDED store's admin is unavailable. */
export default async function AdminRootLayout({ children, params }: Props) {
  const { store } = await getStoreForHost((await params).host);
  if (store.status === "SUSPENDED") {
    const [bn, en] = await Promise.all([
      getTranslations({ locale: "bn", namespace: "storefront" }),
      getTranslations({ locale: "en", namespace: "storefront" }),
    ]);
    return (
      <main
        data-store-status="unavailable"
        className="flex flex-1 items-center justify-center px-4 py-24 text-center"
      >
        <h1 className="text-2xl font-bold">
          {bn("unavailable")} / {en("unavailable")}
        </h1>
      </main>
    );
  }
  return <div className="flex w-full flex-1 flex-col">{children}</div>;
}
