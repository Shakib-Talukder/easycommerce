import type { Metadata } from "next";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { getStoreForHost } from "@/lib/store";

type Props = { children: ReactNode; params: Promise<{ host: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Admin for ACTIVE and PENDING stores; a SUSPENDED store's admin is unavailable. */
export default async function AdminRootLayout({ children, params }: Props) {
  const { store } = await getStoreForHost((await params).host);
  if (store.status === "SUSPENDED") {
    return (
      <main
        data-store-status="unavailable"
        className="flex flex-1 items-center justify-center px-4 py-24 text-center"
      >
        <h1 className="text-2xl font-bold">
          {t("bn", "store.unavailable")} / {t("en", "store.unavailable")}
        </h1>
      </main>
    );
  }
  return <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">{children}</div>;
}
