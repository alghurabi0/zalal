import type { Database } from "@/lib/database.types";

import type { CancelReason, OrderStatus } from "./status";

// Order details' timeline (N4) from order_events. It says what happened and
// who did it (the customer, the company or the crew). Staff notes live in
// order_event_notes, which customers can't read, so they never reach it.

type AppRole = Database["public"]["Enums"]["app_role"];

export type OrderEventRow = {
  id: number;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_role: AppRole | null;
  cancel_reason: CancelReason | null;
  is_override: boolean;
  details: unknown;
  created_at: string;
};

export type TimelineActor = "you" | "company" | "crew";

export type TimelineEntry =
  | { id: number; at: string; kind: "booked" }
  | { id: number; at: string; kind: "rescheduled"; by: TimelineActor; toDate: string | null }
  | { id: number; at: string; kind: "cancelled"; by: TimelineActor; reason: CancelReason | null }
  | { id: number; at: string; kind: "status"; by: TimelineActor; status: OrderStatus };

function actorOf(role: AppRole | null): TimelineActor {
  if (role === "customer") return "you";
  if (role === "crew") return "crew";
  // Admins, and events whose account was deleted since.
  return "company";
}

function newDate(details: unknown): string | null {
  if (details && typeof details === "object" && "to_service_date" in details) {
    const value = (details as { to_service_date: unknown }).to_service_date;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  return null;
}

/** Oldest first. */
export function buildTimeline(events: OrderEventRow[]): TimelineEntry[] {
  return [...events]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)
    .map((event): TimelineEntry => {
      const base = { id: event.id, at: event.created_at };
      const by = actorOf(event.actor_role);
      if (event.from_status === null) return { ...base, kind: "booked" };
      if (
        !event.is_override &&
        event.to_status === "pending_confirmation" &&
        (event.from_status === "pending_confirmation" || event.from_status === "confirmed")
      ) {
        return { ...base, kind: "rescheduled", by, toDate: newDate(event.details) };
      }
      if (event.to_status === "cancelled") {
        return { ...base, kind: "cancelled", by, reason: event.cancel_reason };
      }
      return { ...base, kind: "status", by, status: event.to_status };
    });
}
