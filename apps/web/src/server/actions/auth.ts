"use server";

import { createSession, requestLoginCode, revokeSession, verifyLoginCode } from "@repo/core";
import { identifierSchema } from "@repo/db/validation";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-result";
import { clearSessionCookie, getCurrentStore, getSession, setSessionCookie } from "../auth";
import { getTranslations } from "next-intl/server";
import { failure, sendFailure, validationFailure } from "../i18n";
import { clientIp, userAgent } from "../request";

export async function sendLoginCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const store = await getCurrentStore();
  const parsed = z.object({ identifier: identifierSchema }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const { identifier } = parsed.data;

  const result = await requestLoginCode({ store, identifier, ip: await clientIp() });
  if (!result.ok) return sendFailure(result);
  // Same redirect whether or not the account exists.
  redirect(`/admin/verify?${new URLSearchParams({ identifier: identifier.value })}`);
}

/** "Resend code" on /admin/verify: 60 s server-side cooldown, same limits as the first send. */
export async function resendLoginCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const store = await getCurrentStore();
  const parsed = z.object({ identifier: identifierSchema }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const result = await requestLoginCode({ store, identifier: parsed.data.identifier, ip: await clientIp() });
  if (!result.ok) return sendFailure(result);
  return {
    ok: true,
    message: (await getTranslations("auth"))("resent"),
    data: { sentAt: Date.now(), cooldownSeconds: result.cooldownSeconds },
  };
}

const verifySchema = z.object({
  identifier: identifierSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "INVALID_OTP"),
});

export async function verifyLoginCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const store = await getCurrentStore();
  const parsed = verifySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const result = await verifyLoginCode({ storeId: store.id, ...parsed.data });
  if (!result.ok) return failure(result.error);

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
