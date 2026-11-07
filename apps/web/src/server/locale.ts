import "server-only";
import { forStore } from "@repo/db";
import { findStoreByHost } from "@repo/db/admin";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { LOCALE_COOKIE, SURFACE_HEADER, resolveLocale, type Locale, type Surface } from "@/i18n/locale";
import { getSession } from "./auth";

const rootDomain = () => process.env.ROOT_DOMAIN ?? "localhost:3000";

export async function requestSurface(): Promise<Surface> {
  const surface = (await headers()).get(SURFACE_HEADER);
  return surface === "admin" || surface === "storefront" ? surface : "root";
}

async function storeLanguage(): Promise<string | null> {
  const store = await findStoreByHost((await headers()).get("host") ?? "", rootDomain());
  if (!store) return null;
  const settings = await forStore(store.id).storeSettings.findUnique({
    where: { storeId: store.id },
    select: { language: true },
  });
  return settings?.language ?? null;
}

/** Locale for this request (cached): see resolveLocale() for the order. */
export const getRequestLocale = cache(async (): Promise<Locale> => {
  const surface = await requestSurface();
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (surface === "storefront") return resolveLocale(surface, { storeLanguage: await storeLanguage() });
  if (surface === "admin") {
    // No session (login pages, unknown host) just means "no user preference".
    const session = await getSession().catch(() => null);
    return resolveLocale(surface, { userLocale: session?.user.locale, cookieLocale });
  }
  return resolveLocale(surface, { cookieLocale });
});
