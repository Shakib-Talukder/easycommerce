import { SETTINGS_SECTIONS, isSettingsSection } from "@repo/core";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsTabs } from "@/components/settings-tabs";
import {
  BrandingSection,
  CopyButton,
  DeliverySection,
  IdentitySection,
  PaymentsSection,
} from "@/components/store-settings";
import { requireRole } from "@/server/auth";
import { requestProtocol } from "@/server/request";
import { loadSettingsValues } from "@/server/store-settings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("metaTitle") };
}

const SECTIONS = {
  identity: IdentitySection,
  branding: BrandingSection,
  payments: PaymentsSection,
  delivery: DeliverySection,
} as const;

type Props = { searchParams: Promise<{ tab?: string }> };

/** OWNER only. Same section components and validation as the onboarding wizard. */
export default async function SettingsPage({ searchParams }: Props) {
  const { store } = await requireRole("OWNER");
  const tab = (await searchParams).tab;
  const active = isSettingsSection(tab) ? tab : "identity";
  const [{ values }, t, to] = await Promise.all([
    loadSettingsValues(store.id),
    getTranslations("settings"),
    getTranslations("onboarding"),
  ]);
  const url = `${await requestProtocol()}://${store.subdomain}.${process.env.ROOT_DOMAIN ?? "localhost:3000"}`;
  const Section = SECTIONS[active];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t("subdomain")}</p>
        <div className="flex items-center gap-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
          <code className="min-w-0 flex-1 truncate text-sm" data-store-url>
            {url}
          </code>
          <CopyButton text={url} />
        </div>
        <p className="text-xs text-neutral-500">{t("subdomainReadOnly")}</p>
      </div>
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="sr-only">{to(`steps.${active}`)}</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsTabs
            tabs={SETTINGS_SECTIONS.map((s) => ({ id: s, label: to(`steps.${s}`) }))}
            active={active}
          >
            {/* key: remount on tab change so each tab starts from saved values. */}
            <Section key={active} values={values} mode={{ kind: "settings" }} />
          </SettingsTabs>
        </CardContent>
      </Card>
    </div>
  );
}
