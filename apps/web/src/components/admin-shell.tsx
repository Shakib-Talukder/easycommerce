import { can, type StoreContext, type ValidSession } from "@repo/core";
import { forStore, storeDisplayName } from "@repo/db";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/server/actions/auth";
import { requestProtocol } from "@/server/request";
import { NavLink } from "./admin-nav-link";
import { LocaleSwitcher } from "./locale-switcher";

/*
 * Admin shell (mobile first):
 *   < 768 px  top bar (logo, store name, language, menu) + fixed bottom navigation
 *             (Dashboard, Products, Categories, More), safe-area aware.
 *   ≥ 768 px  sidebar with every section.
 * Every item is a plain link, so navigation works without JavaScript.
 */

type Props = {
  store: StoreContext;
  user: ValidSession["user"];
  /** While onboarding is unfinished (STAFF view) only the essentials are shown. */
  limited?: boolean;
  children: ReactNode;
};

const ICONS = {
  dashboard: "M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  products: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10",
  categories: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

export async function adminLinks(user: ValidSession["user"]) {
  const [t, tc] = await Promise.all([getTranslations("common"), getTranslations("catalog.nav")]);
  const catalog = can(user.role, "catalog:manage");
  return [
    { href: "/admin", label: t("nav.dashboard"), exact: true, show: true },
    { href: "/admin/products", label: tc("products"), show: catalog },
    { href: "/admin/categories", label: tc("categories"), show: catalog },
    { href: "/admin/products/featured", label: tc("featured"), show: catalog, sub: true },
    { href: "/admin/products/trash", label: tc("trash"), show: catalog, sub: true },
    { href: "/admin/staff", label: t("nav.staff"), show: can(user.role, "staff:manage") },
    { href: "/admin/settings", label: t("nav.settings"), show: can(user.role, "settings:manage") },
  ].filter((l) => l.show);
}

export async function storeUrl(store: StoreContext) {
  return `${await requestProtocol()}://${store.subdomain}.${process.env.ROOT_DOMAIN ?? "localhost:3000"}`;
}

export async function AdminShell({ store, user, limited, children }: Props) {
  const [locale, t, links, settings, url] = await Promise.all([
    getLocale(),
    getTranslations("common"),
    adminLinks(user),
    forStore(store.id).storeSettings.findUnique({ where: { storeId: store.id }, select: { logoUrl: true } }),
    storeUrl(store),
  ]);
  const name = storeDisplayName(store, locale as "bn" | "en");
  const logo = settings?.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- already resized to 512 px and immutable
    <img
      src={settings.logoUrl}
      alt=""
      width={32}
      height={32}
      className="size-8 shrink-0 rounded object-contain"
      data-admin-logo
    />
  ) : (
    <span aria-hidden className="size-8 shrink-0 rounded bg-[var(--brand)]" />
  );
  const sideLink =
    "flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800";
  const sideActive = "bg-[var(--brand)]/10 text-[var(--brand)] dark:text-[var(--brand)]";
  const bottom = [
    { href: "/admin", label: t("nav.dashboard"), icon: "dashboard" as const, exact: true },
    ...(limited
      ? []
      : [
          {
            href: "/admin/products",
            label: links.find((l) => l.href === "/admin/products")?.label ?? "",
            icon: "products" as const,
          },
          {
            href: "/admin/categories",
            label: links.find((l) => l.href === "/admin/categories")?.label ?? "",
            icon: "categories" as const,
          },
        ]),
    { href: "/admin/more", label: t("nav.more"), icon: "more" as const },
  ];

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]" data-admin-shell>
      {/* Sidebar (≥ 768 px) */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 overflow-y-auto border-r border-neutral-200 p-4 md:flex dark:border-neutral-800">
        <Link href="/admin" className="flex min-h-11 items-center gap-2 font-bold text-[var(--brand)]">
          {logo}
          <span className="min-w-0 break-words">{name}</span>
        </Link>
        <nav aria-label={t("nav.main")} className="flex flex-col gap-1">
          {(limited ? links.slice(0, 1) : links).map((l) => (
            <NavLink
              key={l.href}
              href={l.href}
              exact={l.exact}
              className={`${sideLink} ${l.sub ? "pl-6" : ""}`}
              activeClassName={sideActive}
            >
              {l.label}
            </NavLink>
          ))}
          <a href={url} target="_blank" rel="noreferrer" className={sideLink}>
            {t("nav.viewStore")}
          </a>
        </nav>
        <div className="mt-auto flex flex-col gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <LocaleSwitcher />
          <p className="text-sm text-neutral-500" data-user-role={user.role}>
            {user.name} · {t(`roles.${user.role}`)}
          </p>
          <form action={logoutAction}>
            <button
              type="submit"
              className={`${sideLink} w-full border border-neutral-300 dark:border-neutral-700`}
            >
              {t("nav.logout")}
            </button>
          </form>
        </div>
      </aside>

      {/* Top bar (< 768 px) */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-neutral-200 bg-white/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden dark:border-neutral-800 dark:bg-neutral-950/95">
        <Link
          href="/admin"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 font-bold text-[var(--brand)]"
        >
          {logo}
          <span className="truncate">{name}</span>
        </Link>
        <LocaleSwitcher compact />
        <Link
          href="/admin/more"
          className="flex size-11 items-center justify-center rounded-md"
          aria-label={t("nav.menu")}
          data-menu
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </Link>
      </header>

      <main className="min-w-0 px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-8 md:py-6">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>

      {/* Bottom navigation (< 768 px) */}
      <nav
        aria-label={t("nav.main")}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden dark:border-neutral-800 dark:bg-neutral-950"
        data-bottom-nav
      >
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${bottom.length}, minmax(0, 1fr))` }}>
          {bottom.map((item) => (
            <li key={item.href}>
              <NavLink
                href={item.href}
                exact={item.exact}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] text-neutral-500"
                activeClassName="text-[var(--brand)] font-semibold"
                testId={item.icon}
              >
                <Icon name={item.icon} />
                <span className="max-w-full truncate">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
