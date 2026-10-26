import type { OrderStatus } from "@/lib/orders/status";

// What the crew app (spec §8.1) shows and offers for each status. The
// database decides what may change (transition_order, spec §6); these only
// choose the buttons.

/** Jobs still to do or under way (C2's main groups). */
export const OPEN_JOB_STATUSES = [
  "confirmed",
  "on_the_way",
  "arrived",
  "in_progress",
] as const satisfies readonly OrderStatus[];

/** Today's finished jobs (C2's "خلصت" group). */
export const DONE_JOB_STATUSES = ["completed", "no_show"] as const satisfies readonly OrderStatus[];

export type OpenJobStatus = (typeof OPEN_JOB_STATUSES)[number];

export function isOpenJob(status: OrderStatus): status is OpenJobStatus {
  return (OPEN_JOB_STATUSES as readonly OrderStatus[]).includes(status);
}

/**
 * C3a's big button: the next status and its label key. Starting work and
 * finishing need no photo (settled Oct 26, 2026). Finishing opens the
 * finish sheet (C4) for the cash tick.
 */
export type JobStep =
  | { to: "on_the_way"; label: "leave" }
  | { to: "arrived"; label: "arrive" }
  | { to: "in_progress"; label: "start" }
  | { to: "completed"; label: "finish" };

export function nextStep(status: OrderStatus): JobStep | null {
  switch (status) {
    case "confirmed":
      return { to: "on_the_way", label: "leave" };
    case "on_the_way":
      return { to: "arrived", label: "arrive" };
    case "arrived":
      return { to: "in_progress", label: "start" };
    case "in_progress":
      return { to: "completed", label: "finish" };
    default:
      return null;
  }
}

/** "الزبون مو موجود" (no-show) is offered until work starts (spec §6). */
export function canMarkNoShow(status: OrderStatus): boolean {
  return status === "confirmed" || status === "on_the_way" || status === "arrived";
}
