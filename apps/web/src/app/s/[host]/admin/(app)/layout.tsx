import { can } from "@repo/core";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminHeader } from "@/components/admin-header";
import { requireUser } from "@/server/auth";

/**
 * Admin shell. Until onboarding is complete the OWNER is sent to the wizard
 * and STAFF see a "setup in progress" notice instead of the page.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user, store } = await requireUser();
  if (!store.onboardingCompleted && user.role === "OWNER") redirect("/admin/onboarding");

  const [t, to, tcat] = await Promise.all([
    getTranslations("common"),
    getTranslations("onboarding"),
    getTranslations("catalog.nav"),
  ]);
  const links = [
    { href: "/admin", label: t("nav.dashboard"), show: true },
    { href: "/admin/products", label: tcat("products"), show: can(user.role, "catalog:manage") },
    { href: "/admin/categories", label: tcat("categories"), show: can(user.role, "catalog:manage") },
    { href: "/admin/staff", label: t("nav.staff"), show: can(user.role, "staff:manage") },
    { href: "/admin/settings", label: t("nav.settings"), show: can(user.role, "settings:manage") },
  ].filter((l) => l.show);

  return (
    <div className="flex flex-col gap-6">
      <AdminHeader store={store} user={user} links={store.onboardingCompleted ? links : []} />
      {store.onboardingCompleted ? (
        children
      ) : (
        <section data-setup-in-progress className="mx-auto flex max-w-md flex-col gap-2 py-12 text-center">
          <h1 className="text-xl font-semibold">{to("setupInProgress")}</h1>
          <p className="text-neutral-500">{to("setupInProgressBody")}</p>
        </section>
      )}
    </div>
  );
}
