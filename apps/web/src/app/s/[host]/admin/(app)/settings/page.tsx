import { forStore, poishaToTakaString } from "@repo/db";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import type { Metadata } from "next";
import { SettingsForm } from "@/components/admin-forms";
import { t } from "@/lib/i18n";
import { requireRole } from "@/server/auth";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { store } = await requireRole("OWNER");
  const s = await forStore(store.id).storeSettings.findUniqueOrThrow({ where: { storeId: store.id } });

  return (
    <div className="mx-auto w-full max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>{t(store.language, "settings.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm
            lang={store.language}
            values={{
              primaryColor: s.primaryColor,
              language: s.language,
              contactPhone: s.contactPhone ?? "",
              contactEmail: s.contactEmail ?? "",
              address: s.address ?? "",
              deliveryChargeInsideDhaka: poishaToTakaString(s.deliveryChargeInsideDhaka),
              deliveryChargeOutsideDhaka: poishaToTakaString(s.deliveryChargeOutsideDhaka),
              codEnabled: s.codEnabled,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
