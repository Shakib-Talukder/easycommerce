"use server";

import {
  ForeignKeyError,
  ImageUploadError,
  getStorageProvider,
  isSettingsSection,
  launchStore,
  parseSection,
  processAndStoreImage,
  saveSettingsSection,
  saveStoreLogo,
  skipOnboardingStep,
  stepOf,
} from "@repo/core";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-result";
import { requirePermission, requireRole } from "../auth";
import { failure, validationFailure } from "../i18n";

/** Only steps without required fields can be skipped. */
const SKIPPABLE = new Set(["branding"]);

/**
 * Saves one settings section. Used by the onboarding wizard (mode=onboarding:
 * records the step and moves to the next one) and by /admin/settings
 * (mode=settings: stays on the tab and shows a toast).
 */
export async function saveSectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { store } = await requirePermission("settings:manage");
  const section = formData.get("section");
  if (!isSettingsSection(section)) return failure("INVALID");
  const onboarding = formData.get("mode") === "onboarding";
  // After "Edit" on the review screen, return there instead of the next step.
  const next = formData.get("return") === "finish" ? 5 : stepOf(section) + 1;

  if (onboarding && formData.get("intent") === "skip" && SKIPPABLE.has(section)) {
    await skipOnboardingStep(store.id, section);
    redirect(`/admin/onboarding?step=${next}`);
  }

  const parsed = parseSection(section, Object.fromEntries(formData));
  if (!parsed.ok) return validationFailure(parsed.error);
  await saveSettingsSection(store.id, parsed.value, { completeStep: onboarding });
  revalidatePath("/", "layout");

  if (onboarding) redirect(`/admin/onboarding?step=${next}`);
  return { ok: true, message: (await getTranslations("common"))("saved") };
}

/** "Launch store": onboarding_completed_at + status ACTIVE. */
export async function launchStoreAction(_prev: ActionState): Promise<ActionState> {
  const { store } = await requireRole("OWNER");
  const result = await launchStore(store.id);
  if (!result.ok) return failure(result.error);
  revalidatePath("/", "layout");
  redirect("/admin/onboarding/launched");
}

/**
 * Logo upload: magic-byte check, ≤ 5 MB, ≥ 128 px, EXIF stripped, 512 px WebP
 * logo + 64 px PNG favicon, then the previous files are deleted. Returns the
 * new URL and a primary colour suggested from the logo's dominant colour.
 */
export async function uploadLogoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { store } = await requirePermission("settings:manage");
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return failure("UPLOAD_MISSING");

  try {
    const image = await processAndStoreImage("logo", {
      storeId: store.id,
      data: Buffer.from(await file.arrayBuffer()),
    });
    await saveStoreLogo(store.id, image.variants).catch(async (error: unknown) => {
      // Don't leave orphaned objects behind when the database update fails.
      const storage = getStorageProvider();
      await Promise.allSettled(Object.values(image.variants).map((v) => storage.delete(v.key)));
      throw error;
    });
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: (await getTranslations("settings.branding"))("logoUploaded"),
      data: { logoUrl: image.variants.logo.url, suggestedColor: image.dominantColor },
    };
  } catch (error) {
    if (error instanceof ImageUploadError) return failure(error.code);
    if (error instanceof ForeignKeyError) return failure(error.code);
    throw error;
  }
}
