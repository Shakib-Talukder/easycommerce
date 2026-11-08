"use client";

import { Button, Input, Label, cn, type ButtonProps, type InputProps } from "@repo/ui";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action-result";

export function SubmitButton({ children, className, ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  const t = useTranslations("common");
  return (
    <Button
      type="submit"
      size="lg"
      className={cn("w-full", className)}
      disabled={pending}
      aria-busy={pending}
      {...props}
    >
      {pending ? t("working") : children}
    </Button>
  );
}

export function FormMessage({ state, hideSuccess }: { state: ActionState; hideSuccess?: boolean }) {
  if (!state || (state.ok && (hideSuccess || !state.message))) return null;
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

export function fieldErrorsOf(state: ActionState, name: string): string[] | undefined {
  return state && !state.ok ? state.fieldErrors?.[name] : undefined;
}

/** Error (or hint) line under a field, linked via aria-describedby. */
export function FieldMessage({ id, errors, hint }: { id: string; errors?: string[]; hint?: ReactNode }) {
  return (
    <p
      id={id}
      data-field-error={errors?.[0] ? "" : undefined}
      className={cn("text-xs", errors ? "text-red-600 dark:text-red-400" : "text-neutral-500")}
    >
      {errors?.[0] ?? hint}
    </p>
  );
}

function LabelText({ label, optional }: { label: string; optional?: boolean }) {
  const t = useTranslations("common");
  return (
    <>
      {label}
      {optional ? <span className="font-normal text-neutral-500"> ({t("optional")})</span> : null}
    </>
  );
}

type FieldProps = InputProps & {
  name: string;
  label: string;
  state: ActionState;
  hint?: ReactNode;
  optional?: boolean;
};

/** Label + input + per-field error from a typed action result. */
export function Field({ name, label, state, hint, optional, className, ...input }: FieldProps) {
  const errors = fieldErrorsOf(state, name);
  const id = `f-${name}`;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>
        <LabelText label={label} optional={optional} />
      </Label>
      <Input id={id} name={name} invalid={Boolean(errors)} aria-describedby={`${id}-msg`} {...input} />
      <FieldMessage id={`${id}-msg`} errors={errors} hint={hint} />
    </div>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  name: string;
  label: string;
  state: ActionState;
  optional?: boolean;
  children: ReactNode;
};

export function SelectField({
  name,
  label,
  state,
  optional,
  className,
  children,
  ...select
}: SelectFieldProps) {
  const errors = fieldErrorsOf(state, name);
  const id = `f-${name}`;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>
        <LabelText label={label} optional={optional} />
      </Label>
      <select
        id={id}
        name={name}
        aria-invalid={errors ? true : undefined}
        aria-describedby={`${id}-msg`}
        className={cn(
          "h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-base md:text-sm dark:border-neutral-700 dark:bg-neutral-900",
          errors && "border-red-500",
        )}
        {...select}
      >
        {children}
      </select>
      <FieldMessage id={`${id}-msg`} errors={errors} />
    </div>
  );
}

/** A labelled checkbox styled as a toggle row. */
export function Toggle({
  name,
  label,
  hint,
  checked,
  defaultChecked,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
        className="mt-0.5 size-5 shrink-0 accent-[var(--brand)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        {hint ? <span className="text-xs text-neutral-500">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Success toast for a saved form; hides itself after a few seconds. */
export function Toast({ state }: { state: ActionState }) {
  // Rendered straight from the action state (so it also shows without JavaScript), hidden by a timer.
  const [dismissed, setDismissed] = useState<ActionState>(null);
  useEffect(() => {
    if (!state?.ok) return;
    const timer = setTimeout(() => setDismissed(state), 3500);
    return () => clearTimeout(timer);
  }, [state]);
  if (!state?.ok || !state.message || dismissed === state) return null;
  return (
    <div
      role="status"
      data-toast
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-lg bg-neutral-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-white dark:text-neutral-900"
    >
      {state.message}
    </div>
  );
}

export { Button };

type CodeAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * "Resend code" with a countdown. The server decides: the countdown starts from
 * the cooldown left when the page loaded, then from what each resend returns
 * (cooldownSeconds after a send, secondsLeft after RESEND_COOLDOWN).
 */
export function ResendCodeForm({
  action,
  fields,
  initialSeconds,
  label,
  countdown,
}: {
  action: CodeAction;
  fields: Record<string, string>;
  initialSeconds: number;
  label: string;
  countdown: (seconds: number) => string;
}) {
  const [state, formAction] = useActionState(action, null);
  const fromServer = state?.data?.cooldownSeconds ?? state?.data?.secondsLeft;
  const seconds = typeof fromServer === "number" ? fromServer : initialSeconds;
  // A new key per response restarts the countdown.
  const key = state
    ? `${String(state.data?.sentAt ?? "")}:${state.ok ? "ok" : state.code}:${seconds}`
    : "initial";
  return (
    <form action={formAction} className="flex flex-col items-center gap-2" noValidate data-resend-form>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <FormMessage state={state} />
      <ResendButton key={key} start={seconds} label={label} countdown={countdown} />
    </form>
  );
}

function ResendButton({
  start,
  label,
  countdown,
}: {
  start: number;
  label: string;
  countdown: (seconds: number) => string;
}) {
  const [seconds, setSeconds] = useState(start);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  // Without JavaScript the button stays enabled; the server's cooldown still applies.
  return (
    <Button type="submit" variant="ghost" size="sm" disabled={seconds > 0} data-resend-seconds={seconds}>
      {seconds > 0 ? countdown(seconds) : label}
    </Button>
  );
}
