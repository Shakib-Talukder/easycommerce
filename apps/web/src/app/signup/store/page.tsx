import { readSignupTicket } from "@repo/core";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StoreDetailsForm } from "@/components/signup-forms";
import { SignupShell } from "@/components/signup-shell";
import { SIGNUP_TICKET_COOKIE } from "@/lib/signup";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("signup"))("storeTitle") };
}

/** Signup screen 3: store names + subdomain. Requires a valid signup ticket. */
export default async function SignupStorePage() {
  const ticket = await readSignupTicket((await cookies()).get(SIGNUP_TICKET_COOKIE)?.value);
  if (!ticket) redirect("/signup");
  const t = await getTranslations("signup");
  return (
    <SignupShell step={3} title={t("storeTitle")} description={t("storeBody")}>
      <p className="text-sm text-neutral-500" data-ticket-phone={ticket.phone}>
        {ticket.phone}
      </p>
      <StoreDetailsForm rootDomain={process.env.ROOT_DOMAIN ?? "localhost:3000"} />
      <Link href="/signup" className="text-center text-sm underline">
        {t("startOver")}
      </Link>
    </SignupShell>
  );
}
