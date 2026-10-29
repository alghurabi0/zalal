import type { Database } from "@/lib/database.types";
import { routes } from "@/lib/routes";

// Order statuses as the customer screens show them: Orders' tabs and
// buttons (spec §5.12), Order details (N4) and Home's active-order card
// (§5.5). The database decides what may change (transition_order, spec §6);
// these only choose what to show.

export type OrderStatus = Database["public"]["Enums"]["order_status"];
export type CancelReason = Database["public"]["Enums"]["cancel_reason"];

export const CANCEL_REASONS = [
  "plans_changed",
  "time_unsuitable",
  "other",
] as const satisfies readonly CancelReason[];

/** الحالية: from booking until the work is done; a postponed order is still open. */
export const CURRENT_STATUSES = [
  "pending_confirmation",
  "confirmed",
  "postponed",
  "on_the_way",
  "arrived",
  "in_progress",
] as const satisfies readonly OrderStatus[];

/** السابقة: the end states. */
export const PAST_STATUSES = [
  "completed",
  "cancelled",
  "no_show",
] as const satisfies readonly OrderStatus[];

export type OrdersTab = "current" | "past";

export function ordersTab(status: OrderStatus): OrdersTab {
  return (CURRENT_STATUSES as readonly OrderStatus[]).includes(status) ? "current" : "past";
}

/** The badge colours from Orders.dc.html, by status. */
export type BadgeTone = "info" | "warn" | "ok" | "neutral";

export function badgeTone(status: OrderStatus): BadgeTone {
  switch (status) {
    case "postponed":
    case "on_the_way":
    case "arrived":
    case "in_progress":
      return "warn";
    case "completed":
      return "ok";
    case "cancelled":
    case "no_show":
      return "neutral";
    default:
      return "info";
  }
}

/**
 * The main button on an order card (spec §5.12): تتبّع opens Tracking while
 * the crew is on the way, تابع الشغل opens Job progress once it has arrived,
 * الشهادة opens the certificate (Report) once the job is completed, and a
 * cancelled order offers أعد الحجز. The rest get تفاصيل الطلب.
 */
export type OrderAction = "details" | "rebook" | "track" | "progress" | "certificate";

export function primaryAction(status: OrderStatus): OrderAction {
  switch (status) {
    case "cancelled":
      return "rebook";
    case "on_the_way":
      return "track";
    case "arrived":
    case "in_progress":
      return "progress";
    case "completed":
      return "certificate";
    default:
      return "details";
  }
}

/** Where an order's main button goes. */
export function actionHref(action: OrderAction, orderId: string): string {
  switch (action) {
    case "rebook":
      return routes.book;
    case "track":
      return routes.tracking(orderId);
    case "progress":
      return routes.jobProgress(orderId);
    case "certificate":
      return routes.certificate(orderId);
    default:
      return routes.order(orderId);
  }
}

/** Tracking (§5.13) is open while the crew is on the way or has arrived. */
export function canTrack(status: OrderStatus): boolean {
  return status === "on_the_way" || status === "arrived";
}

/** Job progress (§5.14) is open from arrival on, and stays readable after completion. */
export function canFollowJob(status: OrderStatus): boolean {
  return status === "arrived" || status === "in_progress" || status === "completed";
}

/**
 * What the customer can still change (spec §6, N6, N7): a pending or
 * confirmed order can be rescheduled, postponed or cancelled until its slot
 * starts (no 2-hour rule since Oct 29, 2026); a postponed order can only be
 * cancelled, at any time, since staff give it its date back. `now` is the
 * server's clock; the database checks again.
 */
export type ChangeState = "allowed" | "too_late" | "postponed" | "closed";

export function changeState(
  status: OrderStatus,
  slotStartAt: string | Date,
  now: Date,
): ChangeState {
  if (status === "postponed") return "postponed";
  if (status !== "pending_confirmation" && status !== "confirmed") return "closed";
  return now.getTime() >= new Date(slotStartAt).getTime() ? "too_late" : "allowed";
}

/**
 * Home's active-order card (spec §5.5): the soonest order from pending to
 * in progress. An order the crew is working on comes first, and a pending
 * or confirmed one whose slot has already ended (staff haven't acted on it
 * yet) or a postponed one (no date) only shows when there is nothing else.
 * `orders` are soonest first.
 */
export function pickActiveOrder<T extends { status: OrderStatus; slot_end_at: string }>(
  orders: T[],
  now: Date,
): T | null {
  const live = orders.find(
    (o) => o.status === "on_the_way" || o.status === "arrived" || o.status === "in_progress",
  );
  if (live) return live;
  return (
    orders.find(
      (o) => o.status !== "postponed" && new Date(o.slot_end_at).getTime() > now.getTime(),
    ) ??
    orders.find((o) => o.status !== "postponed") ??
    orders[0] ??
    null
  );
}
