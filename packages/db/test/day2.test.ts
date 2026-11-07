import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient } from "../src/admin";
import { disconnectAll } from "../src/client";
import { storeDisplayName } from "../src/display";
import { forStore, withStore } from "../src/tenant";
import { hexColorSchema, slugifySubdomain, storeInputSchema } from "../src/validation";
import { createTestStore, deleteStores, rawAppConnection } from "./helpers";

let storeA: { id: string };
let storeB: { id: string };

beforeAll(async () => {
  storeA = await createTestStore("d2a");
  storeB = await createTestStore("d2b");
});

afterAll(async () => {
  await deleteStores(storeA.id, storeB.id);
  await disconnectAll();
});

const settings = (storeId: string) => forStore(storeId).storeSettings;
const update = (storeId: string, data: Parameters<ReturnType<typeof settings>["update"]>[0]["data"]) =>
  settings(storeId).update({ where: { storeId }, data });

describe("store_settings CHECK constraints (day 2)", () => {
  it("accepts only #rrggbb colours", async () => {
    await expect(update(storeA.id, { primaryColor: "#FF0000" })).rejects.toThrow(
      /store_settings_primary_color_chk/,
    );
    await expect(update(storeA.id, { secondaryColor: "red" })).rejects.toThrow(
      /store_settings_secondary_color_chk/,
    );
    await update(storeA.id, { primaryColor: "#0f766e", secondaryColor: "#f59e0b" });
  });

  it("keeps onboarding_step within 0–4", async () => {
    await expect(update(storeA.id, { onboardingStep: 5 })).rejects.toThrow(
      /store_settings_onboarding_step_chk/,
    );
    await expect(update(storeA.id, { onboardingStep: -1 })).rejects.toThrow(
      /store_settings_onboarding_step_chk/,
    );
  });

  it("requires a bKash number and account type when bKash is enabled", async () => {
    await expect(update(storeA.id, { bkashEnabled: true })).rejects.toThrow(
      /store_settings_bkash_enabled_chk/,
    );
    await expect(
      update(storeA.id, { bkashEnabled: true, bkashNumber: "01711000000", bkashAccountType: "PERSONAL" }),
    ).rejects.toThrow(/store_settings_bkash_number_chk/);
    await update(storeA.id, {
      bkashEnabled: true,
      bkashNumber: "+8801711000000",
      bkashAccountType: "PERSONAL",
    });
    await expect(update(storeA.id, { nagadEnabled: true, nagadNumber: "+8801811000000" })).rejects.toThrow(
      /store_settings_nagad_enabled_chk/,
    );
  });

  it("needs at least one payment method once onboarding is complete", async () => {
    await update(storeB.id, { codEnabled: false, onboardingCompletedAt: null });
    await expect(update(storeB.id, { onboardingCompletedAt: new Date() })).rejects.toThrow(
      /store_settings_payment_method_chk/,
    );
    await update(storeB.id, { codEnabled: true, onboardingCompletedAt: new Date() });
    await expect(update(storeB.id, { codEnabled: false })).rejects.toThrow(
      /store_settings_payment_method_chk/,
    );
  });

  it("rejects negative thresholds and out-of-range delivery days", async () => {
    await expect(update(storeA.id, { freeDeliveryThreshold: -1 })).rejects.toThrow(
      /store_settings_free_delivery_chk/,
    );
    await expect(update(storeA.id, { deliveryDaysInsideDhaka: 0 })).rejects.toThrow(
      /store_settings_delivery_days_inside_chk/,
    );
    await expect(update(storeA.id, { deliveryDaysOutsideDhaka: 61 })).rejects.toThrow(
      /store_settings_delivery_days_outside_chk/,
    );
  });

  it("only accepts logo and favicon keys under the store's own prefix", async () => {
    await expect(update(storeA.id, { logoKey: `stores/${storeB.id}/logo/x.webp` })).rejects.toThrow(
      /store_settings_logo_key_chk/,
    );
    await expect(update(storeA.id, { faviconKey: `stores/${storeA.id}/logo/x.png` })).rejects.toThrow(
      /store_settings_favicon_key_chk/,
    );
    await update(storeA.id, {
      logoKey: `stores/${storeA.id}/logo/x.webp`,
      faviconKey: `stores/${storeA.id}/favicon/x.png`,
    });
  });

  it("rejects blank store names", async () => {
    await expect(
      adminClient().store.update({ where: { id: storeA.id }, data: { nameEn: "   " } }),
    ).rejects.toThrow(/stores_name_en_chk/);
  });
});

describe("row-level security on day 2 columns", () => {
  it("can't read or change another store's settings, names or user locale", async () => {
    await update(storeB.id, { bkashEnabled: true, bkashNumber: "+8801911000000", bkashAccountType: "AGENT" });
    const a = forStore(storeA.id);
    expect(await a.storeSettings.findUnique({ where: { storeId: storeB.id } })).toBeNull();
    expect(
      (await a.storeSettings.updateMany({ where: { storeId: storeB.id }, data: { onboardingStep: 4 } }))
        .count,
    ).toBe(0);
    expect((await a.store.updateMany({ where: { id: storeB.id }, data: { nameEn: "pwned" } })).count).toBe(0);

    const userB = await adminClient().user.create({
      data: { storeId: storeB.id, name: "B", phone: "+8801911999001", locale: "en" },
    });
    expect((await a.user.updateMany({ where: { id: userB.id }, data: { locale: "bn" } })).count).toBe(0);
    expect((await adminClient().user.findUnique({ where: { id: userB.id } }))?.locale).toBe("en");
  });

  it("a store can update its own row and settings", async () => {
    await withStore(storeA.id, async (tx) => {
      await tx.store.update({ where: { id: storeA.id }, data: { nameBn: "নতুন নাম" } });
      await tx.storeSettings.update({ where: { storeId: storeA.id }, data: { onboardingStep: 2 } });
    });
    expect((await adminClient().store.findUnique({ where: { id: storeA.id } }))?.nameBn).toBe("নতুন নাম");
  });

  it("signup_store_count() counts owners across stores but exposes no rows", async () => {
    const phone = "+8801711888001";
    await adminClient().user.createMany({
      data: [
        { storeId: storeA.id, name: "O1", phone, role: "OWNER" },
        { storeId: storeB.id, name: "O2", phone, role: "OWNER" },
      ],
    });
    const conn = await rawAppConnection();
    try {
      const { rows } = await conn.query<{ n: number }>(
        "SELECT signup_store_count($1, now() - interval '1 day') AS n",
        [phone],
      );
      expect(rows[0]?.n).toBe(2);
      const users = await conn.query("SELECT 1 FROM users WHERE phone = $1", [phone]);
      expect(users.rowCount).toBe(0);
    } finally {
      await conn.end();
    }
  });
});

describe("day 2 helpers", () => {
  it("storeDisplayName picks the locale and falls back when blank", () => {
    const store = { nameBn: "ঢাকা ফ্যাশন", nameEn: "Dhaka Fashion" };
    expect(storeDisplayName(store, "bn")).toBe("ঢাকা ফ্যাশন");
    expect(storeDisplayName(store, "en")).toBe("Dhaka Fashion");
    expect(storeDisplayName({ nameBn: "ঢাকা", nameEn: " " }, "en")).toBe("ঢাকা");
  });

  it("slugifySubdomain makes a valid candidate from an English name", () => {
    expect(slugifySubdomain("Notun Dokan!")).toBe("notun-dokan");
    expect(slugifySubdomain("  Café  & Co. ")).toBe("cafe-co");
    expect(slugifySubdomain("নতুন দোকান")).toBe("");
    expect(slugifySubdomain("a".repeat(40))).toHaveLength(30);
  });

  it("validates colours and bilingual store input", () => {
    expect(hexColorSchema.parse("#0F766E")).toBe("#0f766e");
    expect(hexColorSchema.safeParse("#fff").success).toBe(false);
    const bad = storeInputSchema.safeParse({ nameBn: "", nameEn: "x", subdomain: "admin" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => i.message).sort()).toEqual(["REQUIRED", "SUBDOMAIN_RESERVED"]);
  });
});
