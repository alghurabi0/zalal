import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

type SwitchProps = Omit<ComponentProps<"input">, "type" | "role" | "className" | "children"> & {
  /** The row's visible text; the whole row toggles. */
  children: ReactNode;
  className?: string;
};

/**
 * The on/off toggle from Profile's "تذكير بموعد التنظيف" row
 * (Profile.dc.html): a 48×28 track, teal when on, with a white knob. A real
 * checkbox with role="switch" inside a <label>, so the whole row is the
 * touch target and screen readers announce it as on or off.
 */
export function Switch({ children, className, ...inputProps }: SwitchProps) {
  return (
    <label
      className={cn(
        "flex min-h-14 cursor-pointer items-center gap-3 select-none",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-teal",
        "has-disabled:cursor-not-allowed has-disabled:opacity-60",
        className,
      )}
    >
      <span className="flex-1">{children}</span>
      <input type="checkbox" role="switch" className="peer sr-only" {...inputProps} />
      <span
        aria-hidden
        className="flex h-7 w-12 shrink-0 items-center justify-end rounded-full bg-disabled p-0.75 transition-colors peer-checked:justify-start peer-checked:bg-teal"
      >
        <span className="size-5.5 rounded-full bg-surface shadow-knob" />
      </span>
    </label>
  );
}
