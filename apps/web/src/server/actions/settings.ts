"use server";

import { forStore, takaToPoisha } from "@repo/db";
import { bdPhoneSchema, emailSchema } from "@repo/db/validation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validationError, type ActionState } from "@/lib/action-result";
import { errorMessage, t } from "@/lib/i18n";
import { requirePermission } from "../auth";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const taka = z
  .string()
  .trim()
  .transform((s, ctx) => {
    try {
      return takaToPoisha(s);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter an amount like 60 or 60.50" });
      return z.NEVER;
    }
  });

const settingsSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #16a34a"),
  language: z.enum(["bn", "en"]),
  contactPhone: z.preprocess(blankToUndefined, bdPhoneSchema.optional()),
  contactEmail: z.preprocess(blankToUndefined, emailSchema.optional()),
  address: z.preprocess(blankToUndefined, z.string().trim().max(300).optional()),
  deliveryChargeInsideDhaka: taka,
  deliveryChargeOutsideDhaka: taka,
  codEnabled: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
});

export async function updateSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { store } = await requirePermission("settings:manage");
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationError(parsed.error, errorMessage(store.language, "VALIDATION"));

  const { contactPhone, contactEmail, address, ...rest } = parsed.data;
  await forStore(store.id).storeSettings.update({
    where: { storeId: store.id },
    data: {
      ...rest,
      contactPhone: contactPhone ?? null,
      contactEmail: contactEmail ?? null,
      address: address ?? null,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true, message: t(parsed.data.language, "settings.saved") };
}
