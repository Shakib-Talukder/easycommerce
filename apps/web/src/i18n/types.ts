import type messages from "../../messages/en.json";
import type { Locale } from "./locale";

// Typed message keys and locales for useTranslations / getTranslations.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
