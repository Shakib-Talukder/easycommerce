import type { ReactNode } from "react";
import { AdminHeader } from "@/components/admin-header";
import { requireRole } from "@/server/auth";

/** The onboarding wizard: OWNER only, without the normal admin navigation. */
export default async function SetupLayout({ children }: { children: ReactNode }) {
  const { store, user } = await requireRole("OWNER");
  return (
    <div className="flex flex-col gap-6">
      <AdminHeader store={store} user={user} />
      {children}
    </div>
  );
}
