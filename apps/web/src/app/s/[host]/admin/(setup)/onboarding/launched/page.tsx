import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CopyButton } from "@/components/store-settings";
import { requireRole } from "@/server/auth";
import { requestProtocol } from "@/server/request";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("onboarding"))("launchedTitle") };
}

/** Shown right after "Launch store". */
export default async function LaunchedPage() {
  const { store } = await requireRole("OWNER");
  if (!store.onboardingCompleted) redirect("/admin/onboarding");
  const t = await getTranslations("onboarding");
  const url = `${await requestProtocol()}://${store.subdomain}.${process.env.ROOT_DOMAIN ?? "localhost:3000"}`;

  return (
    <div className="mx-auto w-full max-w-lg">
      <Card data-launched>
        <CardHeader>
          <CardTitle>{t("launchedTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-neutral-600 dark:text-neutral-400">{t("launchedBody")}</p>
          <div className="flex items-center gap-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
            <code className="min-w-0 flex-1 truncate text-sm" data-store-url>
              {url}
            </code>
            <CopyButton text={url} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-12 flex-1 items-center justify-center rounded-md bg-[var(--brand)] px-6 font-medium text-white"
            >
              {t("viewStore")}
            </a>
            <Link
              href="/admin"
              className="inline-flex h-12 flex-1 items-center justify-center rounded-md border border-neutral-300 px-6 font-medium dark:border-neutral-700"
            >
              {t("goToDashboard")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
