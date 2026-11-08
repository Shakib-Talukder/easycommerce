import { loginResendSecondsLeft } from "@repo/core";
import { identifierSchema } from "@repo/db/validation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin-header";
import { VerifyForm } from "@/components/admin-forms";
import { getCurrentStore } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth"))("verifyTitle") };
}

type Props = { searchParams: Promise<{ identifier?: string }> };

export default async function VerifyPage({ searchParams }: Props) {
  const { identifier } = await searchParams;
  if (!identifier) redirect("/admin/login");
  const [store, t] = await Promise.all([getCurrentStore(), getTranslations("auth")]);
  const parsed = identifierSchema.safeParse(identifier);
  const resendSeconds = parsed.success ? await loginResendSecondsLeft(store.id, parsed.data) : 0;

  return (
    <div className="flex flex-col gap-8">
      <AdminHeader store={store} />
      <div className="mx-auto w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>{t("verifyTitle")}</CardTitle>
            <CardDescription>
              {t("sentHint")} <strong>{identifier}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <VerifyForm identifier={identifier} resendSeconds={resendSeconds} />
            <Link
              href="/admin/login"
              className="inline-flex min-h-11 items-center justify-center text-sm underline"
            >
              {t("useOther")}
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
