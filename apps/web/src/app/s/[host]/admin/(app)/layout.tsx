import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin-shell";
import { requireUser } from "@/server/auth";

/**
 * Admin pages inside the shell (sidebar / bottom navigation). Until onboarding is
 * complete the OWNER is sent to the wizard and STAFF see a "setup in progress"
 * notice instead of the page.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { user, store } = await requireUser();
  if (!store.onboardingCompleted && user.role === "OWNER") redirect("/admin/onboarding");
  const to = await getTranslations("onboarding");

  return (
    <AdminShell store={store} user={user} limited={!store.onboardingCompleted}>
      {store.onboardingCompleted ? (
        children
      ) : (
        <section data-setup-in-progress className="mx-auto flex max-w-md flex-col gap-2 py-12 text-center">
          <h1 className="text-xl font-semibold">{to("setupInProgress")}</h1>
          <p className="text-neutral-500">{to("setupInProgressBody")}</p>
        </section>
      )}
    </AdminShell>
  );
}
