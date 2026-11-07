import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui";
import { SignupForm } from "@/components/signup-forms";

const rootDomain = process.env.ROOT_DOMAIN ?? "localhost:3000";

export default function PlatformHome() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium text-[var(--brand)]">EasyCommerce</p>
        <h1 className="text-4xl font-bold tracking-tight">আপনার অনলাইন দোকান, কয়েক মিনিটে</h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400">
          Launch a storefront for your business with cash on delivery, bKash and Bangla support built in.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Open your store / দোকান খুলুন</CardTitle>
          <CardDescription>
            Your shop will live at <code>yourname.{rootDomain}</code>. We&apos;ll send a one-time code to
            confirm.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm rootDomain={rootDomain} />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-2 text-sm text-neutral-600 dark:text-neutral-400">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">
          Demo stores (after `pnpm db:seed`)
        </h2>
        <ul className="list-disc pl-5">
          {["dhaka-fashion", "rajshahi-mango"].map((s) => (
            <li key={s}>
              <a className="underline" href={`http://${s}.${rootDomain}`}>
                {s}.{rootDomain}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
