import { normalizeBdPhone } from "@repo/db/validation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OtpForm } from "@/components/signup-forms";
import { SignupShell } from "@/components/signup-shell";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("signup"))("otpTitle") };
}

type Props = { searchParams: Promise<{ phone?: string }> };

/** Signup screen 2: the 6-digit code. */
export default async function SignupVerifyPage({ searchParams }: Props) {
  const phone = normalizeBdPhone((await searchParams).phone ?? "");
  if (!phone) redirect("/signup");
  const t = await getTranslations("signup");
  return (
    <SignupShell step={2} title={t("otpTitle")} description={t("otpSent", { phone })}>
      <OtpForm phone={phone} />
      <Link href="/signup" className="text-center text-sm underline">
        {t("changePhone")}
      </Link>
    </SignupShell>
  );
}
