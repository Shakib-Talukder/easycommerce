"use server";

import { createSession, requestLoginCode, revokeSession, verifyLoginCode } from "@repo/core";
import { identifierSchema } from "@repo/db/validation";
import { redirect } from "next/navigation";
import { z } from "zod";
import { validationError, type ActionState } from "@/lib/action-result";
import { errorMessage } from "@/lib/i18n";
import { clearSessionCookie, getCurrentStore, getSession, setSessionCookie } from "../auth";
import { clientIp, userAgent } from "../request";

export async function sendLoginCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const store = await getCurrentStore();
  const parsed = z.object({ identifier: identifierSchema }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationError(parsed.error, errorMessage(store.language, "VALIDATION"));
  const { identifier } = parsed.data;

  const result = await requestLoginCode({ store, identifier, ip: await clientIp() });
  if (!result.ok)
    return { ok: false, code: result.error, message: errorMessage(store.language, result.error) };
  // Same redirect whether or not the account exists.
  redirect(`/admin/verify?${new URLSearchParams({ identifier: identifier.value })}`);
}

const verifySchema = z.object({
  identifier: identifierSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export async function verifyLoginCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const store = await getCurrentStore();
  const parsed = verifySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationError(parsed.error, errorMessage(store.language, "VALIDATION"));

  const result = await verifyLoginCode({ storeId: store.id, ...parsed.data });
  if (!result.ok)
    return { ok: false, code: result.error, message: errorMessage(store.language, result.error) };

  const session = await createSession(store.id, result.user, {
    ip: await clientIp(),
    userAgent: await userAgent(),
  });
  await setSessionCookie(session.token, session.expiresAt);
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  const session = await getSession();
  if (session) await revokeSession(session.store.id, session.session.id);
  await clearSessionCookie();
  redirect("/admin/login");
}
