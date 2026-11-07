"use server";

import { deactivateStaff, inviteStaff } from "@repo/core";
import { identifierSchema } from "@repo/db/validation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validationError, type ActionState } from "@/lib/action-result";
import { errorMessage, t } from "@/lib/i18n";
import { requirePermission } from "../auth";

const inviteSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100),
  identifier: identifierSchema,
});

export async function inviteStaffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { store } = await requirePermission("staff:manage");
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationError(parsed.error, errorMessage(store.language, "VALIDATION"));

  const result = await inviteStaff({ store, ...parsed.data });
  if (!result.ok)
    return { ok: false, code: result.error, message: errorMessage(store.language, result.error) };
  revalidatePath("/admin/staff");
  return { ok: true, message: t(store.language, "staff.invited") };
}

export async function deactivateStaffAction(formData: FormData): Promise<void> {
  const { store, user } = await requirePermission("staff:manage");
  const userId = z.string().min(1).parse(formData.get("userId"));
  await deactivateStaff({ storeId: store.id, actorUserId: user.id, userId });
  revalidatePath("/admin/staff");
}
