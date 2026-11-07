import "server-only";
import { getTranslations } from "next-intl/server";
import type { z } from "zod";
import type { ActionResult } from "@/lib/action-result";

export type ErrorTranslator = (code: string) => string;

/** Maps an error code from packages/core or a zod schema to errors.<CODE> in the request's locale. */
export async function getErrorTranslator(): Promise<ErrorTranslator> {
  const t = await getTranslations("errors");
  return (code) => {
    const key = code as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : t("INVALID");
  };
}

/** A failed ActionResult for an error code, in the request's locale. */
export async function failure(
  code: string,
  extra?: Partial<ActionResult & { ok: false }>,
): Promise<ActionResult> {
  const te = await getErrorTranslator();
  return { ok: false, code, message: te(code), ...extra };
}

/** Per-field errors from a zod error whose issue messages are error codes. */
export async function validationFailure(error: z.ZodError): Promise<ActionResult> {
  const te = await getErrorTranslator();
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (fieldErrors[key] ??= []).push(te(issue.message));
  }
  return { ok: false, code: "VALIDATION", message: te("VALIDATION"), fieldErrors };
}
