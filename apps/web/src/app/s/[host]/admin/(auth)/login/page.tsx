import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin-header";
import { LoginForm } from "@/components/admin-forms";
import { getCurrentStore, getSession } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth"))("loginTitle") };
}

export default async function LoginPage() {
  if (await getSession()) redirect("/admin");
  const [store, t] = await Promise.all([getCurrentStore(), getTranslations("auth")]);
  return (
    <div className="flex flex-col gap-8">
      <AdminHeader store={store} />
      <div className="mx-auto w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>{t("loginTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
