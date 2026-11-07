import { listStaff } from "@repo/core";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import type { Metadata } from "next";
import { InviteForm } from "@/components/admin-forms";
import { t } from "@/lib/i18n";
import { deactivateStaffAction } from "@/server/actions/staff";
import { requireRole } from "@/server/auth";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const { store, user: me } = await requireRole("OWNER");
  const lang = store.language;
  const users = await listStaff(store.id);

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{t(lang, "staff.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{u.name}</p>
                  <p className="truncate text-xs text-neutral-500">
                    {[u.phone, u.email].filter(Boolean).join(" · ")} · {t(lang, `role.${u.role}`)} ·{" "}
                    {u.isActive ? t(lang, "staff.active") : t(lang, "staff.pending")}
                  </p>
                </div>
                {u.role === "STAFF" && u.isActive && u.id !== me.id ? (
                  <form action={deactivateStaffAction}>
                    <input type="hidden" name="userId" value={u.id} />
                    <Button type="submit" variant="outline" size="sm">
                      {t(lang, "staff.deactivate")}
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t(lang, "staff.invite")}</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteForm lang={lang} />
        </CardContent>
      </Card>
    </div>
  );
}
