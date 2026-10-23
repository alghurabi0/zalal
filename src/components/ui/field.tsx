import { type ReactNode, useId } from "react";

import { cn } from "@/lib/cn";

/** Props a Field hands to its control so the label, hint and error connect. */
export type FieldControlProps = {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
};

type FieldProps = {
  label: ReactNode;
  /** Help text under the control, e.g. "مثال: 7801234567". */
  hint?: ReactNode;
  /** Validation message. Marks the control invalid and replaces the hint. */
  error?: ReactNode;
  /** compact matches the 46px inputs inside a sheet (smaller label, tighter gap). */
  variant?: "default" | "compact";
  /** Defaults to a generated id. */
  id?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
};

/**
 * Label + control + hint or error. The control comes from a render
 * function so it gets the ids:
 *
 *   <Field label={t("phone")} hint={t("phoneHint")}>
 *     {(control) => <Input {...control} name="phone" />}
 *   </Field>
 */
export function Field({
  label,
  hint,
  error,
  variant = "default",
  id,
  className,
  children,
}: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const messageId = `${controlId}-message`;
  const message = error ?? hint;

  return (
    <div className={cn("flex flex-col", variant === "compact" ? "gap-1" : "gap-2", className)}>
      <label
        htmlFor={controlId}
        className={cn("font-bold", variant === "compact" ? "text-13" : "text-14")}
      >
        {label}
      </label>
      {children({
        id: controlId,
        "aria-describedby": message ? messageId : undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {/* Always rendered (sr-only when empty, which also drops it out of
          the flex gap) so an error that appears later is announced. */}
      <span
        id={messageId}
        aria-live="polite"
        className={cn(
          "text-13",
          error ? "font-bold text-danger" : "text-muted",
          !message && "sr-only",
        )}
      >
        {message}
      </span>
    </div>
  );
}
