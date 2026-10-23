import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Chips from the canvas.
 *
 * - option: bordered tile; selected = light blue with a navy border (tank
 *   size, slot, OTP channel, issue type).
 * - pill: round filter; selected = navy (Tips categories, address labels).
 * - tag: small round toggle; selected = navy (rating tags).
 * - action: small round button with a light blue border (chat quick replies).
 *
 * option, pill and tag are real radio or checkbox inputs inside a <label>, so
 * they submit with a form, arrow keys move between radios with the same
 * `name`, and screen readers announce them as choices. action is a plain
 * button.
 */
export type ChipVariant = "option" | "pill" | "tag";

const variantClasses: Record<ChipVariant, string> = {
  option:
    "min-h-11.5 flex-col rounded-chip border-2 border-border bg-surface px-2.5 py-1 text-14 font-bold text-muted has-checked:border-navy has-checked:bg-selected has-checked:text-navy",
  // 38–40px tall in the canvas; the ::after strip makes the touch target 44px.
  pill: "h-10 rounded-full border-2 border-border bg-surface px-4 text-14 font-bold text-muted after:absolute after:inset-x-0 after:-inset-y-1 has-checked:border-navy has-checked:bg-navy has-checked:text-white",
  // 36px tall in the canvas; the ::after strip makes the touch target 44px.
  tag: "h-9 rounded-full border border-border bg-bg px-3 text-13 font-bold text-body-2 after:absolute after:inset-x-0 after:-inset-y-1 has-checked:border-navy has-checked:bg-navy has-checked:text-white",
};

type ChipProps = Omit<ComponentProps<"input">, "type" | "className" | "children"> & {
  type: "radio" | "checkbox";
  variant?: ChipVariant;
  className?: string;
  children: ReactNode;
};

export function Chip({ type, variant = "option", className, children, ...inputProps }: ChipProps) {
  return (
    <label
      className={cn(
        "relative inline-flex cursor-pointer items-center justify-center text-center select-none",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-teal",
        variantClasses[variant],
        "has-disabled:cursor-not-allowed has-disabled:border-border has-disabled:bg-bg has-disabled:text-control-off",
        className,
      )}
    >
      <input type={type} className="sr-only" {...inputProps} />
      {children}
    </label>
  );
}

type ChipButtonProps = Omit<ComponentProps<"button">, "className"> & { className?: string };

/** A quick-reply chip: an action, not a choice. */
export function ChipButton({ className, type = "button", ...props }: ChipButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "relative inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-chip-border bg-surface px-3 text-13 font-bold whitespace-nowrap text-teal after:absolute after:inset-x-0 after:-inset-y-1",
        className,
      )}
      {...props}
    />
  );
}

type ChipGroupProps = {
  /** The group's visible label, e.g. "السعة". */
  legend: ReactNode;
  children: ReactNode;
  className?: string;
  /** Layout of the chips, e.g. "grid grid-cols-3". */
  bodyClassName?: string;
};

/** A labelled set of chips: a <fieldset> whose <legend> is the section label. */
export function ChipGroup({ legend, children, className, bodyClassName }: ChipGroupProps) {
  return (
    <fieldset className={className}>
      <legend className="mb-2 text-15 font-extrabold">{legend}</legend>
      <div className={cn("flex flex-wrap gap-2", bodyClassName)}>{children}</div>
    </fieldset>
  );
}
