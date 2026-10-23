import { cn } from "@/lib/cn";

type StepProgressProps = {
  /**
   * A number draws Booking's plain bars (the subtitle "الخطوة 1 من 3"
   * says the same thing, so the bars are hidden from screen readers).
   * A list of labels draws Tracking's labelled steps.
   */
  steps: number | string[];
  /**
   * The current step, from 1. Bars: steps up to and including it are filled.
   * Labels: earlier steps are done, this one is in progress (aqua); pass
   * `steps.length + 1` when all are done.
   */
  current: number;
  className?: string;
};

export function StepProgress({ steps, current, className }: StepProgressProps) {
  if (typeof steps === "number") {
    return (
      <div aria-hidden className={cn("grid auto-cols-fr grid-flow-col gap-1.5", className)}>
        {Array.from({ length: steps }, (_, i) => (
          <span
            key={i}
            className={cn("h-1.25 rounded-full", i < current ? "bg-navy" : "bg-track")}
          />
        ))}
      </div>
    );
  }

  return (
    <ol className={cn("grid auto-cols-fr grid-flow-col gap-1", className)}>
      {steps.map((label, i) => {
        const state = i < current - 1 ? "done" : i === current - 1 ? "now" : "next";
        return (
          <li
            key={label}
            aria-current={state === "now" ? "step" : undefined}
            className="flex flex-col gap-1.5"
          >
            <span
              aria-hidden
              className={cn(
                "h-1.5 rounded-full",
                state === "done" ? "bg-navy" : state === "now" ? "bg-aqua" : "bg-border",
              )}
            />
            <span
              className={cn(
                "text-center text-12",
                state === "next" ? "font-semibold text-muted" : "font-extrabold text-navy",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
