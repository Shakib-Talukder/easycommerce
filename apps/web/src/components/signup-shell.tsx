import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { SIGNUP_STEPS } from "@/lib/signup";
import { LocaleSwitcher } from "./locale-switcher";

/** Root-domain page frame for the 3 signup screens: brand, language toggle, step indicator. */
export async function SignupShell({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const [t, tc] = await Promise.all([getTranslations("signup"), getTranslations("common")]);
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="inline-flex min-h-11 items-center font-semibold text-[var(--brand)]">
          {tc("appName")}
        </Link>
        <LocaleSwitcher />
      </header>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-neutral-500" data-signup-step={step}>
          {t("stepOf", { current: step, total: SIGNUP_STEPS })}
        </p>
        <div className="flex gap-1" aria-hidden>
          {Array.from({ length: SIGNUP_STEPS }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${i < step ? "bg-[var(--brand)]" : "bg-neutral-200 dark:bg-neutral-800"}`}
            />
          ))}
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
    </main>
  );
}
