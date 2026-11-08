import { createId } from "@paralleldrive/cuid2";
import { disconnectAll } from "@repo/db";
import { adminClient } from "@repo/db/admin";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchStore, parseSection, saveSettingsSection, skipOnboardingStep } from "../src/store/settings";
import { deleteStores } from "./helpers";

const created: string[] = [];

afterAll(async () => {
  await deleteStores(...created);
  await disconnectAll();
});

async function pendingStore() {
  const store = await adminClient().store.create({
    data: {
      nameBn: "দোকান",
      nameEn: "Dokan",
      subdomain: `t-onb-${createId().slice(0, 8)}`,
      status: "PENDING",
      settings: { create: {} },
    },
  });
  created.push(store.id);
  return store;
}

const settingsOf = (storeId: string) => adminClient().storeSettings.findUniqueOrThrow({ where: { storeId } });

/** Error codes per field from a failed parse. */
function errors(section: Parameters<typeof parseSection>[0], input: Record<string, unknown>) {
  const result = parseSection(section, input);
  if (result.ok) return {};
  const out: Record<string, string[]> = {};
  for (const issue of result.error.issues) (out[String(issue.path[0])] ??= []).push(issue.message);
  return out;
}

const identity = {
  nameBn: "নতুন দোকান",
  nameEn: "Notun Dokan",
  taglineBn: "",
  taglineEn: "",
  contactPhone: "০১৭১১০০০০০১",
  contactEmail: "",
  addressDivision: "dhaka",
  addressDistrict: "gazipur",
  addressArea: "Tongi",
  address: "",
  language: "bn",
};
const payments = { codEnabled: "on", bkashEnabled: "", bkashNumber: "", nagadEnabled: "", nagadNumber: "" };
const delivery = { deliveryChargeInsideDhaka: "60", deliveryChargeOutsideDhaka: "১২০" };

describe("settings validation per step", () => {
  it("identity: names required, district must belong to the division, Bangla digits normalised", () => {
    const ok = parseSection("identity", identity);
    expect(ok.ok && ok.value.data).toMatchObject({ contactPhone: "+8801711000001", taglineBn: undefined });
    expect(errors("identity", { ...identity, nameBn: " ", nameEn: "" })).toEqual({
      nameBn: ["REQUIRED"],
      nameEn: ["REQUIRED"],
    });
    expect(errors("identity", { ...identity, addressDistrict: "sylhet" })).toEqual({
      addressDistrict: ["INVALID_DISTRICT"],
    });
    expect(errors("identity", { ...identity, addressDivision: "atlantis" })).toMatchObject({
      addressDivision: ["INVALID_DIVISION"],
    });
    expect(errors("identity", { ...identity, contactPhone: "12345", contactEmail: "nope" })).toEqual({
      contactPhone: ["INVALID_PHONE"],
      contactEmail: ["INVALID_EMAIL"],
    });
  });

  it("branding: #rrggbb colours, secondary optional", () => {
    const ok = parseSection("branding", { primaryColor: "#0F766E", secondaryColor: "" });
    expect(ok.ok && ok.value.data).toEqual({ primaryColor: "#0f766e", secondaryColor: undefined });
    expect(errors("branding", { primaryColor: "teal" })).toEqual({ primaryColor: ["INVALID_COLOR"] });
  });

  it("payments: at least one method", () => {
    expect(errors("payments", { codEnabled: "" })).toEqual({ paymentMethods: ["PAYMENT_METHOD_REQUIRED"] });
    expect(parseSection("payments", payments).ok).toBe(true);
  });

  it("payments: bKash/Nagad need a number and account type when enabled", () => {
    expect(errors("payments", { ...payments, bkashEnabled: "on" })).toEqual({
      bkashNumber: ["BKASH_NUMBER_REQUIRED"],
      bkashAccountType: ["ACCOUNT_TYPE_REQUIRED"],
    });
    expect(errors("payments", { ...payments, nagadEnabled: "on", nagadNumber: "01811000000" })).toEqual({
      nagadAccountType: ["ACCOUNT_TYPE_REQUIRED"],
    });
    expect(
      errors("payments", { ...payments, bkashEnabled: "on", bkashNumber: "0171", bkashAccountType: "AGENT" }),
    ).toEqual({ bkashNumber: ["INVALID_PHONE"] });
    const ok = parseSection("payments", {
      codEnabled: "",
      bkashEnabled: "on",
      bkashNumber: "01711000000",
      bkashAccountType: "MERCHANT",
    });
    expect(ok.ok && ok.value.data).toMatchObject({ codEnabled: false, bkashNumber: "+8801711000000" });
  });

  it("delivery: taka to poisha (Bangla digits too), optional threshold and days", () => {
    const ok = parseSection("delivery", {
      ...delivery,
      freeDeliveryThreshold: "1,500",
      deliveryDaysInsideDhaka: "২",
    });
    expect(ok.ok && ok.value.data).toEqual({
      deliveryChargeInsideDhaka: 6000,
      deliveryChargeOutsideDhaka: 12000,
      freeDeliveryThreshold: 150000,
      deliveryDaysInsideDhaka: 2,
      deliveryDaysOutsideDhaka: undefined,
    });
    expect(
      errors("delivery", {
        deliveryChargeInsideDhaka: "",
        deliveryChargeOutsideDhaka: "-5",
        deliveryDaysOutsideDhaka: "0",
      }),
    ).toEqual({
      deliveryChargeInsideDhaka: ["REQUIRED"],
      deliveryChargeOutsideDhaka: ["INVALID_AMOUNT"],
      deliveryDaysOutsideDhaka: ["INVALID_DAYS"],
    });
  });
});

describe("onboarding step persistence", () => {
  let storeId: string;
  beforeAll(async () => {
    storeId = (await pendingStore()).id;
  });

  const save = async (
    section: Parameters<typeof parseSection>[0],
    input: Record<string, unknown>,
    completeStep = true,
    id = storeId,
  ) => {
    const parsed = parseSection(section, input);
    if (!parsed.ok) throw parsed.error;
    return saveSettingsSection(id, parsed.value, { completeStep });
  };

  it("refuses to save or skip a later step before the earlier ones", async () => {
    const other = (await pendingStore()).id;
    expect(await save("delivery", { ...delivery, deliveryChargeInsideDhaka: "75" }, true, other)).toEqual({
      ok: false,
      error: "ONBOARDING_STEP_LOCKED",
    });
    expect(await save("payments", payments, true, other)).toEqual({
      ok: false,
      error: "ONBOARDING_STEP_LOCKED",
    });
    expect(await skipOnboardingStep(other, "branding")).toEqual({
      ok: false,
      error: "ONBOARDING_STEP_LOCKED",
    });
    // Nothing was written or advanced.
    expect(await settingsOf(other)).toMatchObject({ onboardingStep: 0, deliveryChargeInsideDhaka: 6000 });
    // Even if onboarding_step is forced to 4, launch needs the identity data.
    await adminClient().storeSettings.update({ where: { storeId: other }, data: { onboardingStep: 4 } });
    expect(await launchStore(other)).toEqual({ ok: false, error: "ONBOARDING_INCOMPLETE" });
  });

  it("saves each step, advances onboarding_step and never moves it back", async () => {
    expect((await settingsOf(storeId)).onboardingStep).toBe(0);
    await save("identity", identity);
    expect(await adminClient().store.findUnique({ where: { id: storeId } })).toMatchObject({
      nameBn: "নতুন দোকান",
      nameEn: "Notun Dokan",
    });
    expect(await settingsOf(storeId)).toMatchObject({ onboardingStep: 1, addressDistrict: "gazipur" });

    await skipOnboardingStep(storeId, "branding");
    expect((await settingsOf(storeId)).onboardingStep).toBe(2);

    // Editing an earlier step keeps the progress.
    await save("identity", { ...identity, nameEn: "Notun Dokan BD" });
    expect((await settingsOf(storeId)).onboardingStep).toBe(2);
  });

  it("can't launch until all 4 steps are done, then goes ACTIVE", async () => {
    expect(await launchStore(storeId)).toEqual({ ok: false, error: "ONBOARDING_INCOMPLETE" });
    await save("payments", payments);
    await save("delivery", { ...delivery, freeDeliveryThreshold: "2000" });
    expect(await settingsOf(storeId)).toMatchObject({ onboardingStep: 4, freeDeliveryThreshold: 200000 });

    expect(await launchStore(storeId)).toEqual({ ok: true });
    const store = await adminClient().store.findUnique({
      where: { id: storeId },
      include: { settings: true },
    });
    expect(store?.status).toBe("ACTIVE");
    expect(store?.settings?.onboardingCompletedAt).toBeInstanceOf(Date);
  });

  it("the database refuses to drop the last payment method after launch", async () => {
    await expect(
      adminClient().storeSettings.update({ where: { storeId }, data: { codEnabled: false } }),
    ).rejects.toThrow(/store_settings_payment_method_chk/);
  });

  it("never re-activates a suspended store", async () => {
    const other = await pendingStore();
    await adminClient().storeSettings.update({
      where: { storeId: other.id },
      data: {
        onboardingStep: 4,
        contactPhone: "+8801711000000",
        addressDivision: "dhaka",
        addressDistrict: "dhaka",
      },
    });
    await adminClient().store.update({ where: { id: other.id }, data: { status: "SUSPENDED" } });
    expect(await launchStore(other.id)).toEqual({ ok: true });
    expect((await adminClient().store.findUnique({ where: { id: other.id } }))?.status).toBe("SUSPENDED");
  });
});
