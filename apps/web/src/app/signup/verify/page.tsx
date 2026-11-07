import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupVerifyForm } from "@/components/signup-forms";

export const metadata: Metadata = { title: "Confirm your store" };

type Props = { searchParams: Promise<{ subdomain?: string; identifier?: string }> };

export default async function SignupVerifyPage({ searchParams }: Props) {
  const { subdomain, identifier } = await searchParams;
  if (!subdomain || !identifier) redirect("/signup");

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Enter your code / কোড দিন</CardTitle>
          <CardDescription>
            We sent a 6-digit code to <strong>{identifier}</strong> for{" "}
            <strong>
              {subdomain}.{process.env.ROOT_DOMAIN ?? "localhost:3000"}
            </strong>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SignupVerifyForm subdomain={subdomain} identifier={identifier} />
          <Link href="/signup" className="text-center text-sm underline">
            Start over / আবার শুরু করুন
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
