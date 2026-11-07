import { readSignupTicket } from "@repo/core";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PhoneForm } from "@/components/signup-forms";
import { SignupShell } from "@/components/signup-shell";
import { SIGNUP_TICKET_COOKIE } from "@/lib/signup";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("signup"))("metaTitle") };
}

/** Signup screen 1: BD mobile number. */
export default async function SignupPhonePage() {
  // Already verified in this browser: continue with the store details.
  if (await readSignupTicket((await cookies()).get(SIGNUP_TICKET_COOKIE)?.value)) redirect("/signup/store");
  const t = await getTranslations("signup");
  return (
    <SignupShell step={1} title={t("phoneTitle")}>
      <PhoneForm />
    </SignupShell>
  );
}
