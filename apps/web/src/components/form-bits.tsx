"use client";

import { Button, Input, Label, cn, type ButtonProps, type InputProps } from "@repo/ui";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action-result";

export function SubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending} {...props}>
      {pending ? "…" : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      data-error-code={state.ok ? undefined : state.code}
      className={cn(
        "rounded-md px-3 py-2 text-sm",
        state.ok
          ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
          : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
      )}
    >
      {state.message}
    </p>
  );
}

type FieldProps = InputProps & { name: string; label: string; state: ActionState; hint?: string };

/** Label + input + per-field error from a typed action result. */
export function Field({ name, label, state, hint, ...input }: FieldProps) {
  const errors = state && !state.ok ? state.fieldErrors?.[name] : undefined;
  const id = `f-${name}`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} invalid={Boolean(errors)} aria-describedby={`${id}-msg`} {...input} />
      <p id={`${id}-msg`} className={cn("text-xs", errors ? "text-red-600" : "text-neutral-500")}>
        {errors?.[0] ?? hint}
      </p>
    </div>
  );
}
