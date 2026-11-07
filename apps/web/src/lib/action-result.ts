import type { z } from "zod";

/** Result of a server action, consumed by useActionState forms. */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };

export type ActionState = ActionResult | null;

export function validationError(error: z.ZodError, message: string): ActionResult {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { ok: false, code: "VALIDATION", message, fieldErrors };
}
