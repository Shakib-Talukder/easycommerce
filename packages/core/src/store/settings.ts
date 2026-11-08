import { normalizeDigits, takaToPoisha, withStore, type TenantTx } from "@repo/db";
import { bdPhoneSchema, emailSchema, hexColorSchema, storeNameSchema } from "@repo/db/validation";
import { z } from "zod";
import { DIVISIONS, findDistrict } from "./locations";

/*
 * Store settings, shared by the onboarding wizard and /admin/settings.
 * Schemas take raw form values (strings, "on" checkboxes, taka amounts) and
 * report error codes as issue messages; apps translate them.
 */

export const SETTINGS_SECTIONS = ["identity", "branding", "payments", "delivery"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const ONBOARDING_STEP_COUNT = SETTINGS_SECTIONS.length;
/** Wizard step number (1–4) for a section. */
export const stepOf = (section: SettingsSection): number => SETTINGS_SECTIONS.indexOf(section) + 1;
export const isSettingsSection = (v: unknown): v is SettingsSection =>
  SETTINGS_SECTIONS.includes(v as SettingsSection);

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const blankToUndefined = (v: unknown) => (isBlank(v) ? undefined : v);
const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());
const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max, "TOO_LONG").optional());
const requiredString = z.string({ error: "REQUIRED" }).trim().min(1, "REQUIRED");

const taka = requiredString.transform((s, ctx) => {
  try {
    return takaToPoisha(s);
  } catch {
    ctx.addIssue({ code: "custom", message: "INVALID_AMOUNT" });
    return z.NEVER;
  }
});
const optionalTaka = z.preprocess(blankToUndefined, taka.optional());
const deliveryDays = z.preprocess(
  (v) => (isBlank(v) ? undefined : Number(normalizeDigits(String(v)).trim())),
  z
    .number({ error: "INVALID_DAYS" })
    .int("INVALID_DAYS")
    .min(1, "INVALID_DAYS")
    .max(60, "INVALID_DAYS")
    .optional(),
);
const optionalPhone = z.preprocess(blankToUndefined, bdPhoneSchema.optional());
const accountType = z.preprocess(
  blankToUndefined,
  z.enum(["PERSONAL", "AGENT", "MERCHANT"], { error: "ACCOUNT_TYPE_REQUIRED" }).optional(),
);
const divisionIds = DIVISIONS.map((d) => d.id) as [string, ...string[]];

export const identitySchema = z
  .object({
    nameBn: storeNameSchema,
    nameEn: storeNameSchema,
    taglineBn: optionalText(160),
    taglineEn: optionalText(160),
    contactPhone: requiredString.pipe(bdPhoneSchema),
    contactEmail: z.preprocess(blankToUndefined, emailSchema.optional()),
    addressDivision: z.enum(divisionIds, { error: "INVALID_DIVISION" }),
    addressDistrict: requiredString,
    addressArea: optionalText(100),
    address: optionalText(300),
    language: z.enum(["bn", "en"], { error: "REQUIRED" }),
  })
  .superRefine((v, ctx) => {
    if (!findDistrict(v.addressDivision, v.addressDistrict)) {
      ctx.addIssue({ code: "custom", path: ["addressDistrict"], message: "INVALID_DISTRICT" });
    }
  });

export const brandingSchema = z.object({
  primaryColor: hexColorSchema,
  secondaryColor: z.preprocess(blankToUndefined, hexColorSchema.optional()),
});

export const paymentsSchema = z
  .object({
    codEnabled: checkbox,
    bkashEnabled: checkbox,
    bkashNumber: optionalPhone,
    bkashAccountType: accountType,
    nagadEnabled: checkbox,
    nagadNumber: optionalPhone,
    nagadAccountType: accountType,
  })
  .superRefine((v, ctx) => {
    for (const wallet of ["bkash", "nagad"] as const) {
      if (!v[`${wallet}Enabled`]) continue;
      if (!v[`${wallet}Number`]) {
        const message = wallet === "bkash" ? "BKASH_NUMBER_REQUIRED" : "NAGAD_NUMBER_REQUIRED";
        ctx.addIssue({ code: "custom", path: [`${wallet}Number`], message });
      }
      if (!v[`${wallet}AccountType`]) {
        ctx.addIssue({ code: "custom", path: [`${wallet}AccountType`], message: "ACCOUNT_TYPE_REQUIRED" });
      }
    }
    if (!v.codEnabled && !v.bkashEnabled && !v.nagadEnabled) {
      ctx.addIssue({ code: "custom", path: ["paymentMethods"], message: "PAYMENT_METHOD_REQUIRED" });
    }
  });

export const deliverySchema = z.object({
  deliveryChargeInsideDhaka: taka,
  deliveryChargeOutsideDhaka: taka,
  freeDeliveryThreshold: optionalTaka,
  deliveryDaysInsideDhaka: deliveryDays,
  deliveryDaysOutsideDhaka: deliveryDays,
});

export type IdentityData = z.output<typeof identitySchema>;
export type BrandingData = z.output<typeof brandingSchema>;
export type PaymentsData = z.output<typeof paymentsSchema>;
export type DeliveryData = z.output<typeof deliverySchema>;

export type SectionInput =
  | { section: "identity"; data: IdentityData }
  | { section: "branding"; data: BrandingData }
  | { section: "payments"; data: PaymentsData }
  | { section: "delivery"; data: DeliveryData };

export type ParseSectionResult = { ok: true; value: SectionInput } | { ok: false; error: z.ZodError };

/** Parses raw form values for one section. */
export function parseSection(section: SettingsSection, input: Record<string, unknown>): ParseSectionResult {
  const schemas = {
    identity: identitySchema,
    branding: brandingSchema,
    payments: paymentsSchema,
    delivery: deliverySchema,
  } as const;
  const parsed = schemas[section].safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error };
  return { ok: true, value: { section, data: parsed.data } as SectionInput };
}

const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

function settingsUpdate(input: SectionInput) {
  switch (input.section) {
    case "identity": {
      const d = input.data;
      return {
        taglineBn: orNull(d.taglineBn),
        taglineEn: orNull(d.taglineEn),
        contactPhone: d.contactPhone,
        contactEmail: orNull(d.contactEmail),
        addressDivision: d.addressDivision,
        addressDistrict: d.addressDistrict,
        addressArea: orNull(d.addressArea),
        address: orNull(d.address),
        language: d.language,
      };
    }
    case "branding":
      return { primaryColor: input.data.primaryColor, secondaryColor: orNull(input.data.secondaryColor) };
    case "payments": {
      const d = input.data;
      return {
        codEnabled: d.codEnabled,
        bkashEnabled: d.bkashEnabled,
        bkashNumber: orNull(d.bkashNumber),
        bkashAccountType: orNull(d.bkashAccountType),
        nagadEnabled: d.nagadEnabled,
        nagadNumber: orNull(d.nagadNumber),
        nagadAccountType: orNull(d.nagadAccountType),
      };
    }
    case "delivery": {
      const d = input.data;
      return {
        deliveryChargeInsideDhaka: d.deliveryChargeInsideDhaka,
        deliveryChargeOutsideDhaka: d.deliveryChargeOutsideDhaka,
        freeDeliveryThreshold: orNull(d.freeDeliveryThreshold),
        deliveryDaysInsideDhaka: orNull(d.deliveryDaysInsideDhaka),
        deliveryDaysOutsideDhaka: orNull(d.deliveryDaysOutsideDhaka),
      };
    }
  }
}

export type OnboardingStepResult = { ok: true } | { ok: false; error: "ONBOARDING_STEP_LOCKED" };

/** Steps can only be done in order: step n requires steps 1…n-1 (onboarding_step >= n-1). */
async function assertStepReachable(tx: TenantTx, storeId: string, step: number): Promise<boolean> {
  const s = await tx.storeSettings.findUniqueOrThrow({
    where: { storeId },
    select: { onboardingStep: true },
  });
  return s.onboardingStep >= step - 1;
}

/**
 * Records wizard step `step` as done: onboarding_step moves from step-1 to step.
 * Re-saving an earlier step is a no-op; it never moves backwards or skips ahead.
 */
async function completeOnboardingStep(tx: TenantTx, storeId: string, step: number) {
  await tx.storeSettings.updateMany({
    where: { storeId, onboardingStep: step - 1 },
    data: { onboardingStep: step },
  });
}

/**
 * Saves one parsed section (identity also updates the store's names). With
 * `completeStep`, records that wizard step as done so the wizard resumes after it.
 */
export async function saveSettingsSection(
  storeId: string,
  input: SectionInput,
  options: { completeStep?: boolean } = {},
): Promise<OnboardingStepResult> {
  return withStore(storeId, async (tx): Promise<OnboardingStepResult> => {
    // In the wizard, a later step can't be saved (and so marked done) before the earlier ones.
    if (options.completeStep && !(await assertStepReachable(tx, storeId, stepOf(input.section)))) {
      return { ok: false, error: "ONBOARDING_STEP_LOCKED" };
    }
    if (input.section === "identity") {
      const { nameBn, nameEn } = input.data;
      await tx.store.update({ where: { id: storeId }, data: { nameBn, nameEn } });
    }
    await tx.storeSettings.update({ where: { storeId }, data: settingsUpdate(input) });
    if (options.completeStep) await completeOnboardingStep(tx, storeId, stepOf(input.section));
    return { ok: true };
  });
}

/** "Skip for now": marks a wizard step done without saving anything. */
export async function skipOnboardingStep(
  storeId: string,
  section: SettingsSection,
): Promise<OnboardingStepResult> {
  return withStore(storeId, async (tx): Promise<OnboardingStepResult> => {
    if (!(await assertStepReachable(tx, storeId, stepOf(section)))) {
      return { ok: false, error: "ONBOARDING_STEP_LOCKED" };
    }
    await completeOnboardingStep(tx, storeId, stepOf(section));
    return { ok: true };
  });
}

export type LaunchResult =
  | { ok: true }
  | { ok: false; error: "ONBOARDING_INCOMPLETE" | "PAYMENT_METHOD_REQUIRED" };

/** Finishes onboarding: sets onboarding_completed_at and moves a PENDING store to ACTIVE. */
export async function launchStore(storeId: string): Promise<LaunchResult> {
  return withStore(storeId, async (tx): Promise<LaunchResult> => {
    const s = await tx.storeSettings.findUniqueOrThrow({ where: { storeId } });
    if (s.onboardingStep < ONBOARDING_STEP_COUNT) return { ok: false, error: "ONBOARDING_INCOMPLETE" };
    // Defence in depth: the identity step's required fields must really be there.
    if (!s.contactPhone || !findDistrict(s.addressDivision, s.addressDistrict)) {
      return { ok: false, error: "ONBOARDING_INCOMPLETE" };
    }
    if (!s.codEnabled && !s.bkashEnabled && !s.nagadEnabled) {
      return { ok: false, error: "PAYMENT_METHOD_REQUIRED" };
    }
    await tx.storeSettings.update({
      where: { storeId },
      data: { onboardingCompletedAt: s.onboardingCompletedAt ?? new Date() },
    });
    // Never re-activates a SUSPENDED store.
    await tx.store.updateMany({ where: { id: storeId, status: "PENDING" }, data: { status: "ACTIVE" } });
    return { ok: true };
  });
}
