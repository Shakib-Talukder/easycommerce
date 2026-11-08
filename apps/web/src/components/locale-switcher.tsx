import { cn } from "@repo/ui";
import { getLocale, getTranslations } from "next-intl/server";
import { LOCALES } from "@/i18n/locale";
import { setLocaleAction } from "@/server/actions/locale";

/** বাংলা / English toggle. A plain form, so it works without JavaScript. */
export async function LocaleSwitcher({ className, compact }: { className?: string; compact?: boolean }) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations("common")]);
  return (
    <form action={setLocaleAction} className={cn("flex items-center gap-1 text-sm", className)}>
      <span className="sr-only">{t("language")}</span>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="submit"
          name="locale"
          value={l}
          lang={l}
          aria-pressed={l === locale}
          data-locale-option={l}
          className={cn(
            "flex min-h-11 min-w-11 items-center justify-center rounded-md px-2",
            l === locale
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
              : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
          )}
        >
          {compact ? (
            <>
              <span aria-hidden>{t(`localesShort.${l}`)}</span>
              <span className="sr-only">{t(`locales.${l}`)}</span>
            </>
          ) : (
            t(`locales.${l}`)
          )}
        </button>
      ))}
    </form>
  );
}
