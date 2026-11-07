"use server";

import { deactivateStaff, inviteStaff } from "@repo/core";
import { identifierSchema } from "@repo/db/validation";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-result";
import { requirePermission } from "../auth";
import { failure, validationFailure } from "../i18n";

const inviteSchema = z.object({
  name: z.string({ error: "REQUIRED" }).trim().min(1, "REQUIRED").max(100, "TOO_LONG"),
  identifier: identifierSchema,
});

export async function inviteStaffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { store } = await requirePermission("staff:manage");
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const result = await inviteStaff({ store, ...parsed.data });
  if (!result.ok) return failure(result.error);
  revalidatePath("/admin/staff");
  return { ok: true, message: (await getTranslations("staff"))("invited") };
}

export async function deactivateStaffAction(formData: FormData): Promise<void> {
  const { store, user } = await requirePermission("staff:manage");
  const userId = z.string().min(1).parse(formData.get("userId"));
  await deactivateStaff({ storeId: store.id, actorUserId: user.id, userId });
  revalidatePath("/admin/staff");
}
