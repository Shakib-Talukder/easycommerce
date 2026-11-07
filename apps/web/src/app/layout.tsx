import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Inter, Noto_Sans_Bengali } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Self-hosted by next/font with metric-matched fallbacks, so swapping fonts doesn't shift layout.
const latin = Inter({ subsets: ["latin"], variable: "--font-latin", display: "swap" });
const bengali = Noto_Sans_Bengali({ subsets: ["bengali"], variable: "--font-bengali", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: { default: t("appName"), template: `%s · ${t("appName")}` },
    description: t("metaDescription"),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${latin.variable} ${bengali.variable}`}>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
