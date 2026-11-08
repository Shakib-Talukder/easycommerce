"use server";

import {
  createHandoff,
  createStoreFromTicket,
  startPhoneSignup,
  verifyPhoneSignup,
  SIGNUP_TICKET_TTL_SECONDS,
} from "@repo/core";
import { bdPhoneSchema, storeNameSchema } from "@repo/db/validation";
import { getLocale, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-result";
import { SIGNUP_TICKET_COOKIE } from "@/lib/signup";
import { failure, sendFailure, validationFailure } from "../i18n";
import { clientIp, requestProtocol } from "../request";

const phoneSchema = z.object({
  phone: z.string({ error: "REQUIRED" }).trim().min(1, "REQUIRED").pipe(bdPhoneSchema),
});

async function sendCode(formData: FormData) {
  const parsed = phoneSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { state: await validationFailure(parsed.error) };
  const { phone } = parsed.data;
  const result = await startPhoneSignup({ phone, ip: await clientIp(), language: await getLocale() });
  if (!result.ok) return { state: await sendFailure(result) };
  return { phone, cooldownSeconds: result.cooldownSeconds };
}

/** Screen 1: phone → OTP by SMS. */
export async function sendSignupCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sent = await sendCode(formData);
  if (sent.state) return sent.state;
  redirect(`/signup/verify?${new URLSearchParams({ phone: sent.phone })}`);
}

/** Screen 2: "Resend code" (60 s server-side cooldown, plus the same limits as the first send). */
export async function resendSignupCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sent = await sendCode(formData);
  if (sent.state) return sent.state;
  return {
    ok: true,
    message: (await getTranslations("signup"))("resent"),
    data: { sentAt: Date.now(), cooldownSeconds: sent.cooldownSeconds },
  };
}

const verifySchema = z.object({
  phone: z.string({ error: "REQUIRED" }).pipe(bdPhoneSchema),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "INVALID_OTP"),
});

/** Screen 2: OTP → signup ticket (httpOnly cookie on the root host, 30 min). */
export async function verifySignupCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // The OTP widget posts `code`; without JavaScript the six boxes post `digit` six times.
  const code = String(formData.get("code") || formData.getAll("digit").join(""));
  const parsed = verifySchema.safeParse({ phone: formData.get("phone") ?? undefined, code });
  if (!parsed.success) return validationFailure(parsed.error);

  const result = await verifyPhoneSignup(parsed.data);
  if (!result.ok) return failure(result.error);
  (await cookies()).set(SIGNUP_TICKET_COOKIE, result.ticket, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SIGNUP_TICKET_TTL_SECONDS,
  });
  redirect("/signup/store");
}

const storeSchema = z.object({
  nameBn: storeNameSchema,
  nameEn: storeNameSchema,
  subdomain: z.string({ error: "REQUIRED" }).trim().toLowerCase().min(1, "REQUIRED"),
});

/**
 * Screen 3: store details → store (PENDING) + settings + OWNER in one
 * transaction, then a one-time handoff to <sub>.<ROOT_DOMAIN>/admin/onboarding.
 */
export async function createStoreAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const jar = await cookies();
  const ticket = jar.get(SIGNUP_TICKET_COOKIE)?.value;
  if (!ticket) return failure("TICKET_INVALID");
  const parsed = storeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  // Re-checks format, reserved names and availability on the server.
  const result = await createStoreFromTicket({ ticket, ...parsed.data });
  if (!result.ok) {
    if ("suggestions" in result) {
      const state = await failure(result.error, { data: { suggestions: result.suggestions } });
      return state.ok ? state : { ...state, fieldErrors: { subdomain: [state.message] } };
    }
    return failure(result.error);
  }

  jar.delete(SIGNUP_TICKET_COOKIE);
  // The session cookie must be host-only on the store's host, so hand off via a one-time token.
  const token = await createHandoff({ storeId: result.store.id, userId: result.owner.id });
  const root = process.env.ROOT_DOMAIN ?? "localhost:3000";
  redirect(
    `${await requestProtocol()}://${result.store.subdomain}.${root}/admin/handoff?t=${encodeURIComponent(token)}`,
  );
}

/** "Start over" on screen 3: drops the signup ticket, so /signup no longer skips ahead. */
export async function restartSignupAction(): Promise<void> {
  (await cookies()).delete(SIGNUP_TICKET_COOKIE);
  redirect("/signup");
}
