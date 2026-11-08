import type { ReactNode } from "react";
import { AdminHeader } from "@/components/admin-header";
import { requireRole } from "@/server/auth";

/** The onboarding wizard: OWNER only, without the normal admin navigation. */
export default async function SetupLayout({ children }: { children: ReactNode }) {
  const { store, user } = await requireRole("OWNER");
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <AdminHeader store={store} user={user} />
      {children}
    </div>
  );
}
