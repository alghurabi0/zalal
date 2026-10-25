import { describe, expect, it } from "vitest";

import { formatDayTime } from "@/lib/dates";
import { orderChangeErrorFor } from "@/lib/orders/errors";
import {
  badgeTone,
  changeState,
  type OrderStatus,
  ordersTab,
  primaryAction,
} from "@/lib/orders/status";
import { buildTimeline, type OrderEventRow } from "@/lib/orders/timeline";
import { cancelOrderSchema, ordersQuerySchema, rescheduleOrderSchema } from "@/lib/schemas/order";
import { tankStatus } from "@/lib/tanks/status";

const HOUR = 60 * 60 * 1000;

describe("ordersTab", () => {
  it.each<[OrderStatus, "current" | "past"]>([
    ["pending_confirmation", "current"],
    ["confirmed", "current"],
    ["on_the_way", "current"],
    ["arrived", "current"],
    ["in_progress", "current"],
    ["completed", "past"],
    ["cancelled", "past"],
    ["no_show", "past"],
  ])("%s → %s", (status, tab) => {
    expect(ordersTab(status)).toBe(tab);
  });
});

describe("badgeTone and primaryAction", () => {
  it("colours statuses as the design does", () => {
    expect(badgeTone("confirmed")).toBe("info");
    expect(badgeTone("on_the_way")).toBe("warn");
    expect(badgeTone("completed")).toBe("ok");
    expect(badgeTone("cancelled")).toBe("neutral");
  });

  it("offers أعد الحجز only for a cancelled order, details otherwise (until Phase 4)", () => {
    expect(primaryAction("cancelled")).toBe("rebook");
    for (const status of ["pending_confirmation", "on_the_way", "completed", "no_show"] as const) {
      expect(primaryAction(status)).toBe("details");
    }
  });
});

describe("changeState", () => {
  const now = new Date("2026-10-26T06:00:00Z");
  const startIn = (ms: number) => new Date(now.getTime() + ms).toISOString();

  it("allows a change at exactly 2 h", () => {
    expect(changeState("confirmed", startIn(2 * HOUR), now, 2)).toBe("allowed");
  });

  it("refuses a change at 1 h 59 min", () => {
    expect(changeState("pending_confirmation", startIn(2 * HOUR - 60_000), now, 2)).toBe(
      "too_late",
    );
  });

  it("follows the cutoff setting", () => {
    expect(changeState("confirmed", startIn(3 * HOUR), now, 4)).toBe("too_late");
  });

  it("is closed once the crew is on the way or the order has ended", () => {
    expect(changeState("on_the_way", startIn(48 * HOUR), now, 2)).toBe("closed");
    expect(changeState("cancelled", startIn(48 * HOUR), now, 2)).toBe("closed");
  });
});

describe("orderChangeErrorFor", () => {
  it("maps transition_order's codes", () => {
    expect(orderChangeErrorFor("ZL006")).toBe("too_late");
    expect(orderChangeErrorFor("ZL005")).toBe("slot_full");
    expect(orderChangeErrorFor("ZL004")).toBe("slot_unavailable");
    expect(orderChangeErrorFor("ZL010")).toBe("invalid_transition");
    expect(orderChangeErrorFor("P0002")).toBe("failed");
    expect(orderChangeErrorFor(undefined)).toBe("failed");
  });
});

describe("buildTimeline", () => {
  const event = (over: Partial<OrderEventRow>): OrderEventRow => ({
    id: 1,
    from_status: "pending_confirmation",
    to_status: "confirmed",
    actor_role: "admin",
    cancel_reason: null,
    is_override: false,
    details: {},
    created_at: "2026-10-25T10:00:00Z",
    ...over,
  });

  it("orders events oldest first and names who acted", () => {
    const timeline = buildTimeline([
      event({
        id: 3,
        to_status: "on_the_way",
        from_status: "confirmed",
        actor_role: "crew",
        created_at: "2026-10-26T06:00:00Z",
      }),
      event({
        id: 1,
        from_status: null,
        to_status: "pending_confirmation",
        actor_role: "customer",
        created_at: "2026-10-25T09:00:00Z",
      }),
      event({ id: 2 }),
    ]);
    expect(timeline.map((e) => e.kind)).toEqual(["booked", "status", "status"]);
    expect(timeline[1]).toMatchObject({ by: "company", status: "confirmed" });
    expect(timeline[2]).toMatchObject({ by: "crew", status: "on_the_way" });
  });

  it("reads a reschedule and its new date", () => {
    const [entry] = buildTimeline([
      event({
        from_status: "confirmed",
        to_status: "pending_confirmation",
        actor_role: "customer",
        details: { to_service_date: "2026-10-30", to_slot_id: 4 },
      }),
    ]);
    expect(entry).toMatchObject({ kind: "rescheduled", by: "you", toDate: "2026-10-30" });
  });

  it("keeps the customer's cancel reason", () => {
    const [entry] = buildTimeline([
      event({ to_status: "cancelled", actor_role: "customer", cancel_reason: "time_unsuitable" }),
    ]);
    expect(entry).toMatchObject({ kind: "cancelled", by: "you", reason: "time_unsuitable" });
  });

  it("shows an admin override as a status change by the company", () => {
    const [entry] = buildTimeline([
      event({ from_status: "cancelled", to_status: "pending_confirmation", is_override: true }),
    ]);
    expect(entry).toMatchObject({ kind: "status", by: "company", status: "pending_confirmation" });
  });

  it("treats an event without an actor as the company's", () => {
    const [entry] = buildTimeline([event({ actor_role: null })]);
    expect(entry).toMatchObject({ by: "company" });
  });
});

describe("order schemas", () => {
  const orderId = "8b0c6f0e-6c1a-4f43-9d4c-1f2a3b4c5d6e";

  it("accepts the three N6 reasons only", () => {
    expect(cancelOrderSchema.safeParse({ orderId, reason: "plans_changed" }).success).toBe(true);
    expect(cancelOrderSchema.safeParse({ orderId, reason: "because" }).success).toBe(false);
    expect(cancelOrderSchema.safeParse({ orderId: "1", reason: "other" }).success).toBe(false);
  });

  it("needs a date and a slot to reschedule", () => {
    expect(
      rescheduleOrderSchema.safeParse({ orderId, serviceDate: "2026-10-30", slotId: 3 }).success,
    ).toBe(true);
    expect(
      rescheduleOrderSchema.safeParse({ orderId, serviceDate: "30/10", slotId: 3 }).success,
    ).toBe(false);
  });

  it("reads the Orders query, 20 at a time", () => {
    expect(ordersQuerySchema.parse({})).toEqual({ tab: "current", n: 20 });
    expect(ordersQuerySchema.parse({ tab: "past", n: "40" })).toEqual({ tab: "past", n: 40 });
    expect(ordersQuerySchema.parse({ tab: "x", n: "-5" })).toEqual({ tab: "current", n: 20 });
    expect(ordersQuerySchema.parse({ n: "99999" }).n).toBe(500);
  });
});

describe("formatDayTime", () => {
  it("formats in Baghdad time", () => {
    expect(formatDayTime("2026-10-26T06:15:00Z")).toBe("26 تشرين الأول في 9:15 ص");
  });
});

describe("tankStatus", () => {
  const now = new Date("2026-10-26T09:00:00Z");

  it("has no history without a cleaned tank", () => {
    expect(tankStatus([], now, 6)).toEqual({ health: "no_history" });
    expect(tankStatus([{ last_cleaned_at: null }], now, 6)).toEqual({ health: "no_history" });
  });

  it("is ok well before the next date", () => {
    const status = tankStatus([{ last_cleaned_at: "2026-08-26T09:00:00Z" }], now, 6);
    expect(status).toMatchObject({ health: "ok", monthsSince: 2 });
    if (status.health !== "no_history") {
      expect(status.nextDueAt.toISOString()).toBe("2027-02-26T09:00:00.000Z");
      expect(status.fill).toBeCloseTo(1 / 3, 1);
    }
  });

  it("is due soon within 30 days", () => {
    expect(tankStatus([{ last_cleaned_at: "2026-05-10T09:00:00Z" }], now, 6)).toMatchObject({
      health: "due_soon",
      monthsSince: 5,
    });
  });

  it("is overdue after the interval, with a full bar", () => {
    expect(tankStatus([{ last_cleaned_at: "2026-03-20T09:00:00Z" }], now, 6)).toMatchObject({
      health: "overdue",
      monthsSince: 7,
      fill: 1,
    });
  });

  it("follows the tank due soonest", () => {
    const status = tankStatus(
      [
        { last_cleaned_at: "2026-09-01T09:00:00Z" },
        { last_cleaned_at: null },
        { last_cleaned_at: "2026-03-20T09:00:00Z" },
      ],
      now,
      6,
    );
    expect(status).toMatchObject({ health: "overdue", lastCleanedAt: "2026-03-20T09:00:00Z" });
  });
});
