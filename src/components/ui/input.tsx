import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/**
 * Text inputs from the canvas.
 * - default: 56px, white (Login phone).
 * - compact: 46px, grey fill, for forms inside a sheet (Location).
 * Focus turns the border teal and 2px wide; `aria-invalid` turns it red.
 */
export type InputVariant = "default" | "compact";

const variantClasses: Record<InputVariant, string> = {
  default: "h-14 rounded-input bg-surface px-4 text-16",
  compact: "h-11.5 rounded-chip bg-bg px-3 text-15",
};

// The 1px ring plus the 1px border make the canvas's 2px focus border
// without shifting the text.
const fieldClasses = cn(
  "w-full min-w-0 border border-border text-navy placeholder:text-muted",
  "focus-visible:outline-none focus:border-teal focus:ring-1 focus:ring-teal",
  "aria-invalid:border-danger aria-invalid:ring-1 aria-invalid:ring-danger",
  "disabled:cursor-not-allowed disabled:bg-bg disabled:text-muted",
);

type InputProps = Omit<ComponentProps<"input">, "className"> & {
  variant?: InputVariant;
  className?: string;
};

export function Input({ variant = "default", className, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(fieldClasses, variantClasses[variant], className)}
      {...props}
    />
  );
}

type TextareaProps = Omit<ComponentProps<"textarea">, "className"> & { className?: string };

/** Multi-line note (Upload, Issue). */
export function Textarea({ className, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(
        fieldClasses,
        "resize-none rounded-input bg-surface px-3 py-2.5 text-14",
        className,
      )}
      {...props}
    />
  );
}
