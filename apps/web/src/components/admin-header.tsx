import { forStore, storeDisplayName } from "@repo/db";
import { Button } from "@repo/ui";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ValidSession, StoreContext } from "@repo/core";
import { logoutAction } from "@/server/actions/auth";
import { LocaleSwitcher } from "./locale-switcher";

type Props = {
  store: StoreContext;
  user?: ValidSession["user"];
  links?: { href: string; label: string }[];
};

/** Admin top bar: store logo + name (in the admin's language), language toggle, user, logout. */
export async function AdminHeader({ store, user, links = [] }: Props) {
  const [locale, t, settings] = await Promise.all([
    getLocale(),
    getTranslations("common"),
    forStore(store.id).storeSettings.findUnique({
      where: { storeId: store.id },
      select: { logoUrl: true },
    }),
  ]);
  return (
    <header className="flex flex-col gap-3 border-b border-neutral-200 pb-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin" className="flex min-w-0 items-center gap-2 font-bold text-[var(--brand)]">
          {settings?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- already resized to 512 px and immutable
            <img
              src={settings.logoUrl}
              alt=""
              width={32}
              height={32}
              className="size-8 rounded object-contain"
              data-admin-logo
            />
          ) : (
            <span aria-hidden className="size-8 shrink-0 rounded bg-[var(--brand)]" />
          )}
          <span className="truncate">{storeDisplayName(store, locale)}</span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitcher />
          {user ? (
            <form action={logoutAction}>
              <Button type="submit" variant="outline" size="sm">
                {t("nav.logout")}
              </Button>
            </form>
          ) : null}
        </div>
      </div>
      {user ? (
        <nav aria-label={t("nav.main")} className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="font-medium hover:text-[var(--brand)]">
              {l.label}
            </Link>
          ))}
          <a href="/" className="text-neutral-500 hover:text-[var(--brand)]" target="_blank" rel="noreferrer">
            {t("nav.viewStore")}
          </a>
          <span className="ml-auto text-neutral-500" data-user-role={user.role}>
            {user.name} · {t(`roles.${user.role}`)}
          </span>
        </nav>
      ) : null}
    </header>
  );
}
