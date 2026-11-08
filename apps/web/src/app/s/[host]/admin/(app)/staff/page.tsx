import { listStaff } from "@repo/core";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InviteForm } from "@/components/admin-forms";
import { deactivateStaffAction } from "@/server/actions/staff";
import { requireRole } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("staff"))("metaTitle") };
}

export default async function StaffPage() {
  const { store, user: me } = await requireRole("OWNER");
  const [users, t, tc] = await Promise.all([
    listStaff(store.id),
    getTranslations("staff"),
    getTranslations("common"),
  ]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{u.name}</p>
                  <p className="truncate text-xs text-neutral-500">
                    {[u.phone, u.email].filter(Boolean).join(" · ")} · {tc(`roles.${u.role}`)} ·{" "}
                    {u.isActive ? t("active") : t("pending")}
                  </p>
                </div>
                {u.role === "STAFF" && u.isActive && u.id !== me.id ? (
                  <form action={deactivateStaffAction}>
                    <input type="hidden" name="userId" value={u.id} />
                    <Button type="submit" variant="outline" size="sm">
                      {t("deactivate")}
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
          <CardTitle>{t("invite")}</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteForm />
        </CardContent>
      </Card>
    </div>
  );
}
