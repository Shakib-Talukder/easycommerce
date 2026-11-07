import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { getStoreForHost } from "@/lib/store";

type Props = { children: ReactNode; params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { settings } = await getStoreForHost((await params).host);
  return settings.faviconUrl ? { icons: { icon: settings.faviconUrl } } : {};
}

/** Shared by the storefront and the admin: store language and brand colours. */
export default async function StoreHostLayout({ children, params }: Props) {
  const { settings } = await getStoreForHost((await params).host);
  return (
    <div
      lang={settings.language}
      style={
        {
          "--brand": settings.primaryColor,
          "--brand-2": settings.secondaryColor ?? settings.primaryColor,
        } as CSSProperties
      }
      className="flex min-h-dvh flex-col"
    >
      {children}
    </div>
  );
}
