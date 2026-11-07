import "server-only";
import { forStore, poishaToTakaString } from "@repo/db";

/** Form values for the settings sections (wizard + /admin/settings), as strings for inputs. */
export type StoreSettingsValues = {
  subdomain: string;
  nameBn: string;
  nameEn: string;
  taglineBn: string;
  taglineEn: string;
  contactPhone: string;
  contactEmail: string;
  addressDivision: string;
  addressDistrict: string;
  addressArea: string;
  address: string;
  language: "bn" | "en";
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  codEnabled: boolean;
  bkashEnabled: boolean;
  bkashNumber: string;
  bkashAccountType: string;
  nagadEnabled: boolean;
  nagadNumber: string;
  nagadAccountType: string;
  deliveryChargeInsideDhaka: string;
  deliveryChargeOutsideDhaka: string;
  freeDeliveryThreshold: string;
  deliveryDaysInsideDhaka: string;
  deliveryDaysOutsideDhaka: string;
};

/** +8801711000000 → 01711000000 (what people type). */
const localPhone = (e164: string | null) => (e164 ? e164.replace(/^\+88/, "") : "");
/** 6000 → "60", 6050 → "60.50". */
const taka = (poisha: number | null) =>
  poisha === null ? "" : poishaToTakaString(poisha).replace(/\.00$/, "");

export async function loadSettingsValues(storeId: string) {
  const store = await forStore(storeId).store.findUniqueOrThrow({
    where: { id: storeId },
    include: { settings: true },
  });
  const s = store.settings;
  if (!s) throw new Error(`Store ${storeId} has no settings row`);
  const values: StoreSettingsValues = {
    subdomain: store.subdomain,
    nameBn: store.nameBn,
    nameEn: store.nameEn,
    taglineBn: s.taglineBn ?? "",
    taglineEn: s.taglineEn ?? "",
    contactPhone: localPhone(s.contactPhone),
    contactEmail: s.contactEmail ?? "",
    addressDivision: s.addressDivision ?? "",
    addressDistrict: s.addressDistrict ?? "",
    addressArea: s.addressArea ?? "",
    address: s.address ?? "",
    language: s.language,
    logoUrl: s.logoUrl,
    primaryColor: s.primaryColor,
    secondaryColor: s.secondaryColor ?? "",
    codEnabled: s.codEnabled,
    bkashEnabled: s.bkashEnabled,
    bkashNumber: localPhone(s.bkashNumber),
    bkashAccountType: s.bkashAccountType ?? "",
    nagadEnabled: s.nagadEnabled,
    nagadNumber: localPhone(s.nagadNumber),
    nagadAccountType: s.nagadAccountType ?? "",
    deliveryChargeInsideDhaka: taka(s.deliveryChargeInsideDhaka),
    deliveryChargeOutsideDhaka: taka(s.deliveryChargeOutsideDhaka),
    freeDeliveryThreshold: taka(s.freeDeliveryThreshold),
    deliveryDaysInsideDhaka: s.deliveryDaysInsideDhaka?.toString() ?? "",
    deliveryDaysOutsideDhaka: s.deliveryDaysOutsideDhaka?.toString() ?? "",
  };
  return { values, settings: s, store };
}
