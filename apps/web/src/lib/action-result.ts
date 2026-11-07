/**
 * Result of a server action, consumed by useActionState forms. `message` is
 * already translated; `code` is the stable error code (also rendered as
 * data-error-code for tests).
 */
export type ActionResult =
  | { ok: true; message?: string; data?: Record<string, unknown> }
  | {
      ok: false;
      code: string;
      message: string;
      fieldErrors?: Record<string, string[]>;
      data?: Record<string, unknown>;
    };

export type ActionState = ActionResult | null;
