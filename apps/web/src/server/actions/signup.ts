"use server";

import { completeSignup, createHandoff, startSignup } from "@repo/core";
import { identifierSchema, subdomainSchema } from "@repo/db/validation";
import { redirect } from "next/navigation";
import { z } from "zod";
import { validationError, type ActionState } from "@/lib/action-result";
import { errorMessage } from "@/lib/i18n";
import { clientIp, requestProtocol } from "../request";

const startSchema = z.object({
  storeName: z.string().trim().min(2, "Enter your store name").max(100),
  subdomain: subdomainSchema,
  identifier: identifierSchema,
});

export async function startSignupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = startSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationError(parsed.error, errorMessage("en", "VALIDATION"));
  const { storeName, subdomain, identifier } = parsed.data;

  const result = await startSignup({ storeName, subdomain, identifier, ip: await clientIp() });
  if (!result.ok) {
    return {
      ok: false,
      code: result.error,
      message: errorMessage("en", result.error),
      ...(result.error === "SUBDOMAIN_TAKEN"
        ? { fieldErrors: { subdomain: [errorMessage("en", result.error)] } }
        : {}),
    };
  }
  const query = new URLSearchParams({ subdomain, identifier: identifier.value });
  redirect(`/signup/verify?${query}`);
}

const verifySchema = z.object({
  subdomain: subdomainSchema,
  identifier: identifierSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export async function verifySignupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = verifySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationError(parsed.error, errorMessage("en", "VALIDATION"));
  const { subdomain, identifier, code } = parsed.data;

  const result = await completeSignup({ subdomain, identifier, code });
  if (!result.ok) return { ok: false, code: result.error, message: errorMessage("en", result.error) };

  // The session cookie must be host-only on the store's host, so hand off via a one-time token.
  const token = await createHandoff({ storeId: result.store.id, userId: result.owner.id });
  const root = process.env.ROOT_DOMAIN ?? "localhost:3000";
  redirect(`${await requestProtocol()}://${subdomain}.${root}/admin/handoff?t=${encodeURIComponent(token)}`);
}
