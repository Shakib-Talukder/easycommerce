import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import type { Metadata } from "next";
import { SignupForm } from "@/components/signup-forms";

export const metadata: Metadata = { title: "Open your store" };

export default function SignupPage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Open your store / দোকান খুলুন</CardTitle>
        </CardHeader>
        <CardContent>
          <SignupForm rootDomain={process.env.ROOT_DOMAIN ?? "localhost:3000"} />
        </CardContent>
      </Card>
    </main>
  );
}
