import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { VerifyForm } from "@/components/admin-forms";
import { t } from "@/lib/i18n";
import { getCurrentStore } from "@/server/auth";

export const metadata: Metadata = { title: "Enter code" };

type Props = { searchParams: Promise<{ identifier?: string }> };

export default async function VerifyPage({ searchParams }: Props) {
  const { identifier } = await searchParams;
  if (!identifier) redirect("/admin/login");
  const store = await getCurrentStore();
  const lang = store.language;

  return (
    <div className="mx-auto w-full max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>{t(lang, "verify.title")}</CardTitle>
          <CardDescription>
            {t(lang, "login.sentHint")} <strong>{identifier}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <VerifyForm lang={lang} identifier={identifier} />
          <Link href="/admin/login" className="text-center text-sm underline">
            {t(lang, "verify.other")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
