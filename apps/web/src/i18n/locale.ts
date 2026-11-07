/** Locale plumbing shared by the proxy, server code and tests (no Next.js imports). */

export const LOCALES = ["bn", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "bn";

/** Browser-level language choice (root domain, login pages, and admin fallback). */
export const LOCALE_COOKIE = "ec_locale";

/**
 * Which part of the app a request is for. Set by proxy.ts on every request
 * (any client-sent value is overwritten), read by the next-intl request config.
 */
export const SURFACE_HEADER = "x-ec-surface";
export type Surface = "root" | "admin" | "storefront";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export type LocaleSources = {
  /** users.locale of the logged-in admin user. */
  userLocale?: string | null;
  /** ec_locale cookie. */
  cookieLocale?: string | null;
  /** store_settings.language (storefront default). */
  storeLanguage?: string | null;
};

/**
 * - admin:      logged-in user's users.locale → ec_locale cookie → bn
 * - storefront: the store's default language → bn
 * - root:       ec_locale cookie → bn
 */
export function resolveLocale(surface: Surface, sources: LocaleSources): Locale {
  const candidates =
    surface === "admin"
      ? [sources.userLocale, sources.cookieLocale]
      : surface === "storefront"
        ? [sources.storeLanguage]
        : [sources.cookieLocale];
  return candidates.find(isLocale) ?? DEFAULT_LOCALE;
}

export function surfaceFor(isStoreHost: boolean, pathname: string): Surface {
  if (!isStoreHost) return "root";
  return pathname === "/admin" || pathname.startsWith("/admin/") ? "admin" : "storefront";
}
