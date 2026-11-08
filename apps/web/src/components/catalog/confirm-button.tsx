"use client";

import { cn } from "@repo/ui";
import { useState, type ReactNode } from "react";

/**
 * A two-step destructive button: the first tap reveals the question with
 * "Yes" / "Keep" (inline, no browser dialog). Submits its form with the given
 * hidden fields. Without JavaScript the confirm step is skipped.
 */
export function ConfirmButton({
  action,
  fields,
  label,
  question,
  yes,
  no,
  danger = true,
  testId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  label: ReactNode;
  question: ReactNode;
  yes: ReactNode;
  no: ReactNode;
  danger?: boolean;
  testId?: string;
}) {
  const [asking, setAsking] = useState(false);
  const base = "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium";
  const tone = danger
    ? "border border-red-300 text-red-700 dark:border-red-800 dark:text-red-300"
    : "border border-neutral-300 dark:border-neutral-700";
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" data-confirm={testId}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {asking ? (
        <>
          <span className="text-sm" role="alert">
            {question}
          </span>
          <button
            type="submit"
            className={cn(base, danger ? "bg-red-600 text-white" : "bg-[var(--brand)] text-white")}
            data-confirm-yes
          >
            {yes}
          </button>
          <button type="button" className={cn(base, tone)} onClick={() => setAsking(false)}>
            {no}
          </button>
        </>
      ) : (
        <button
          type="submit"
          className={cn(base, tone)}
          onClick={(e) => {
            e.preventDefault();
            setAsking(true);
          }}
          data-confirm-start
        >
          {label}
        </button>
      )}
    </form>
  );
}
