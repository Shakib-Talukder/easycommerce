import { getRequestConfig } from "next-intl/server";
import { getRequestLocale } from "@/server/locale";
import { isLocale } from "./locale";

/**
 * next-intl without locale-prefixed routing: the locale comes from the request
 * (see server/locale.ts), unless a caller asks for one explicitly, e.g.
 * getTranslations({ locale: "en" }) on the bilingual "coming soon" page.
 */
export default getRequestConfig(async ({ locale: explicit }) => {
  const locale = isLocale(explicit) ? explicit : await getRequestLocale();
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: "Asia/Dhaka",
  };
});
