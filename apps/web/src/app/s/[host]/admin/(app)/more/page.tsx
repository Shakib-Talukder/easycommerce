import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { adminLinks, storeUrl } from "@/components/admin-shell";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { logoutAction } from "@/server/actions/auth";
import { requireUser } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("common"))("nav.more") };
}

const row =
  "flex min-h-12 items-center justify-between rounded-lg border border-neutral-200 px-4 text-base font-medium dark:border-neutral-800";

/** "More" on phones: every section the bottom bar doesn't show, language, and log out. Plain links. */
export default async function MorePage() {
  const { user, store } = await requireUser();
  const [t, links, url] = await Promise.all([getTranslations("common"), adminLinks(user), storeUrl(store)]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("nav.more")}</h1>
      <nav aria-label={t("nav.main")}>
        <ul className="flex flex-col gap-2">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className={row}>
                {l.label}
                <span aria-hidden>›</span>
              </Link>
            </li>
          ))}
          <li>
            <a href={url} target="_blank" rel="noreferrer" className={row}>
              {t("nav.viewStore")}
              <span aria-hidden>↗</span>
            </a>
          </li>
        </ul>
      </nav>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-neutral-500">{t("language")}</h2>
        <LocaleSwitcher />
      </section>
      <p className="text-sm text-neutral-500" data-user-role={user.role}>
        {user.name} · {t(`roles.${user.role}`)}
      </p>
      <form action={logoutAction}>
        <button type="submit" className={`${row} w-full justify-center`}>
          {t("nav.logout")}
        </button>
      </form>
    </div>
  );
}
