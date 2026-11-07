import { can } from "@repo/core";
import { Button } from "@repo/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { logoutAction } from "@/server/actions/auth";
import { requireUser } from "@/server/auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user, store } = await requireUser();
  const lang = store.language;
  const links = [
    { href: "/admin", label: t(lang, "nav.dashboard"), show: true },
    { href: "/admin/staff", label: t(lang, "nav.staff"), show: can(user.role, "staff:manage") },
    { href: "/admin/settings", label: t(lang, "nav.settings"), show: can(user.role, "settings:manage") },
  ].filter((l) => l.show);

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-200 pb-3 text-sm dark:border-neutral-800">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="font-medium hover:text-[var(--brand)]">
            {l.label}
          </Link>
        ))}
        <span className="ml-auto text-neutral-500">
          {user.name} · {t(lang, `role.${user.role}`)}
        </span>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" size="sm">
            {t(lang, "nav.logout")}
          </Button>
        </form>
      </nav>
      {children}
    </div>
  );
}
