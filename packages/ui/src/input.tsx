import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "./cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
};

export function Input({ className, invalid, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        // 44 px tall; 16 px text on phones so iOS Safari doesn't zoom into the field.
        "flex h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-base md:text-sm",
        "placeholder:text-neutral-400 focus-visible:ring-2 focus-visible:ring-[var(--brand,#16a34a)] focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900",
        invalid && "border-red-500 focus-visible:ring-red-500",
        className,
      )}
      {...props}
    />
  );
}
