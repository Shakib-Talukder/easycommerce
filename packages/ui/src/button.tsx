import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "./cn";

const variants = {
  primary: "bg-[var(--brand,#16a34a)] text-white hover:brightness-110",
  secondary: "bg-neutral-100 text-neutral-900 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100",
  outline:
    "border border-neutral-300 bg-transparent hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900",
  ghost: "bg-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800",
  danger: "bg-red-600 text-white hover:bg-red-700",
} as const;

// Every size is at least 44 px tall: a comfortable tap target on phones.
const sizes = {
  sm: "min-h-11 min-w-11 px-3 text-sm",
  md: "min-h-11 min-w-11 px-4 text-sm",
  lg: "min-h-12 px-6 text-base",
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition",
        "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
