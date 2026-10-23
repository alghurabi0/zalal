"use client";

import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { cn } from "@/lib/cn";

type StepperProps = {
  /** Accessible name of the control, e.g. "عدد الخزانات". */
  label: string;
  /** Controlled value. Leave unset and use defaultValue for uncontrolled. */
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max: number;
  /** Submits the value with a form under this name. */
  name?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * The quantity stepper from Booking: − value +. At a limit the button is
 * aria-disabled rather than disabled, so keyboard focus stays on it.
 */
export function Stepper({
  label,
  value,
  defaultValue,
  onValueChange,
  min = 1,
  max,
  name,
  disabled = false,
  className,
}: StepperProps) {
  const t = useTranslations("UI");
  const [internal, setInternal] = useState(defaultValue ?? min);
  const current = value ?? internal;

  const set = (next: number) => {
    if (disabled || next < min || next > max) return;
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };

  const atMin = disabled || current <= min;
  const atMax = disabled || current >= max;

  return (
    <div role="group" aria-label={label} className={cn("flex items-center gap-3", className)}>
      <button
        type="button"
        aria-label={t("decrease")}
        aria-disabled={atMin || undefined}
        onClick={() => set(current - 1)}
        className="flex size-11 items-center justify-center rounded-chip border border-border bg-bg text-navy aria-disabled:cursor-not-allowed aria-disabled:text-control-off"
      >
        <Minus aria-hidden className="size-5.5" strokeWidth={2.6} />
      </button>
      <output aria-live="polite" className="min-w-5 text-center text-20 font-black">
        {current}
      </output>
      <button
        type="button"
        aria-label={t("increase")}
        aria-disabled={atMax || undefined}
        onClick={() => set(current + 1)}
        className="flex size-11 items-center justify-center rounded-chip bg-navy text-white aria-disabled:cursor-not-allowed aria-disabled:bg-disabled aria-disabled:text-muted"
      >
        <Plus aria-hidden className="size-5.5" strokeWidth={2.6} />
      </button>
      {name && <input type="hidden" name={name} value={current} />}
    </div>
  );
}
