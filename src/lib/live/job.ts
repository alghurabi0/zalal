import type { OrderStatus } from "@/lib/orders/status";

import type { StepState } from "./tracking";

// Job progress's timeline (spec §5.14): وصل الفريق / بدأ الشغل / خلص الشغل,
// each with the time it happened, from the order's status and events.

export const JOB_STEPS = ["arrived", "in_progress", "completed"] as const;
export type JobStep = (typeof JOB_STEPS)[number];

/**
 * A step is done once the job has passed it, and "now" while the work it
 * starts is going on (بدأ الشغل during in_progress). `times` are the events'
 * times; a step can be done without one (an admin override skipped it).
 */
export function jobSteps(
  status: OrderStatus,
  times: Partial<Record<JobStep, string>>,
): { step: JobStep; state: StepState; at: string | null }[] {
  const reached = status === "completed" ? 3 : status === "in_progress" ? 2 : status === "arrived" ? 1 : 0;
  return JOB_STEPS.map((step, index) => ({
    step,
    state:
      index < reached
        ? status === "in_progress" && step === "in_progress"
          ? "now"
          : "done"
        : "next",
    at: index < reached ? (times[step] ?? null) : null,
  }));
}

/** Live while the crew works (the "مباشر" badge, §5.14). */
export function isLive(status: OrderStatus): boolean {
  return status === "in_progress";
}
