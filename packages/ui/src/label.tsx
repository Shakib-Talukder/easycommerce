import type { LabelHTMLAttributes } from "react";
import { cn } from "./cn";

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      className={cn("text-sm leading-none font-medium text-neutral-800 dark:text-neutral-200", className)}
      {...props}
    />
  );
}
