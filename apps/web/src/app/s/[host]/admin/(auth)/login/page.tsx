import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin-forms";
import { t } from "@/lib/i18n";
import { getCurrentStore, getSession } from "@/server/auth";

export const metadata: Metadata = { title: "Admin login" };

export default async function LoginPage() {
  if (await getSession()) redirect("/admin");
  const store = await getCurrentStore();
  return (
    <div className="mx-auto w-full max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>{t(store.language, "login.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm lang={store.language} />
        </CardContent>
      </Card>
    </div>
  );
}
