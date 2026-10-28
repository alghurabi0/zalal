import { describe, expect, it } from "vitest";

import { adminEditErrorFor } from "@/lib/admin/edit-errors";
import { adminOrderErrorFor } from "@/lib/admin/errors";
import { bookingErrorFor, isSubscriptionError } from "@/lib/booking/errors";
import {
  activateSubscriptionSchema,
  adjustSubscriptionVisitsSchema,
  subscriptionPlanSchema,
} from "@/lib/schemas/subscription";
import { requestSubscriptionErrorFor } from "@/lib/subscriptions/errors";
import {
  canRequest,
  coverageFor,
  currentFor,
  hasRenewal,
  nextVisit,
  type Subscription,
} from "@/lib/subscriptions/state";

// The subscription's screen rules (spec N8, §5.8, §5.11; Phase 6, task 2;
// one per address, settled Oct 28, 2026). The database enforces the same
// rules (pgTAP); these decide what the screens show.

const HOME = "00000000-0000-4000-8000-000000000001";
const FAMILY = "00000000-0000-4000-8000-000000000002";
// 10:00 on 28 Oct 2026 in Baghdad.
const NOW = new Date("2026-10-28T07:00:00Z");

function subscription(patch: Partial<Subscription> = {}): Subscription {
  return {
    id: "s-1",
    userId: "u-1",
    addressId: HOME,
    state: "active",
    requestedAt: "2026-10-01T09:00:00Z",
    activatedAt: "2026-10-02T09:00:00Z",
    endedAt: null,
    priceIqd: 60000,
    visitsTotal: 2,
    tanksCovered: 1,
    startsOn: "2026-10-02",
    endsOn: "2027-10-01",
    paid: true,
    visitsUsed: 0,
    visitsHeld: 0,
    visitsLeft: 2,
    nextOrderId: null,
    nextOrderAt: null,
    lastVisitOn: null,
    address: { label: "home", district: "حي الحسين", landmark: "قرب الجامع" },
    customer: { name: "أحمد", phone: "+9647801234567" },
    ...patch,
  };
}

describe("currentFor", () => {
  it("shows the running subscription first, then the request, then the latest ended", () => {
    const running = subscription({ id: "running" });
    const renewal = subscription({ id: "renewal", state: "requested", startsOn: null });
    const old = subscription({ id: "old", state: "expired", requestedAt: "2025-10-01T09:00:00Z" });
    expect(currentFor([old, renewal, running], HOME)?.id).toBe("running");
    expect(currentFor([old, renewal], HOME)?.id).toBe("renewal");
    expect(currentFor([old], HOME)?.id).toBe("old");
    expect(currentFor([running], FAMILY)).toBeNull();
    expect(hasRenewal([running, renewal], running)).toBe(true);
    expect(hasRenewal([running], running)).toBe(false);
  });
});

describe("canRequest", () => {
  it("offers a request with nothing live, and a renewal from 30 days before the end", () => {
    expect(canRequest([], HOME, NOW)).toBe(true);
    expect(canRequest([subscription()], HOME, NOW)).toBe(false);
    expect(canRequest([subscription({ endsOn: "2026-11-27" })], HOME, NOW)).toBe(true);
    expect(canRequest([subscription({ endsOn: "2026-11-28" })], HOME, NOW)).toBe(false);
    expect(canRequest([subscription({ state: "requested" })], HOME, NOW)).toBe(false);
    expect(canRequest([subscription({ state: "declined" })], HOME, NOW)).toBe(true);
    expect(canRequest([subscription()], FAMILY, NOW)).toBe(true);
  });
});

describe("nextVisit", () => {
  it("is the booked covered order when there is one", () => {
    expect(
      nextVisit(subscription({ nextOrderId: "o-1", nextOrderAt: "2026-11-02T05:00:00Z" }), 6, NOW),
    ).toEqual({ kind: "booked", orderId: "o-1", at: "2026-11-02T05:00:00Z" });
  });

  it("is due today with no visit used yet, then the interval after the last one", () => {
    expect(nextVisit(subscription(), 6, NOW)).toEqual({ kind: "due", day: "2026-10-28" });
    expect(nextVisit(subscription({ startsOn: "2026-12-01" }), 6, NOW)).toEqual({
      kind: "due",
      day: "2026-12-01",
    });
    expect(nextVisit(subscription({ lastVisitOn: "2026-10-10", visitsLeft: 1 }), 6, NOW)).toEqual({
      kind: "due",
      day: "2027-04-10",
    });
  });

  it("is nothing with no visit left or past the end", () => {
    expect(nextVisit(subscription({ visitsLeft: 0 }), 6, NOW)).toBeNull();
    expect(
      nextVisit(subscription({ lastVisitOn: "2027-05-01", endsOn: "2027-10-01" }), 6, NOW),
    ).toBeNull();
  });
});

describe("coverageFor", () => {
  it("covers a booking inside the period with a visit left and few enough tanks", () => {
    expect(coverageFor([subscription()], HOME, "2026-11-02", 1).status).toBe("usable");
    expect(coverageFor([subscription()], FAMILY, "2026-11-02", 1).status).toBe("none");
    expect(coverageFor([subscription({ state: "expired" })], HOME, "2026-11-02", 1).status).toBe(
      "none",
    );
  });

  it("says why it can't, in create_order's order", () => {
    const reason = (subs: Subscription[], day: string, tanks: number) => {
      const coverage = coverageFor(subs, HOME, day, tanks);
      return coverage.status === "blocked" ? coverage.reason : coverage.status;
    };
    expect(reason([subscription()], "2027-10-02", 1)).toBe("outside_subscription_period");
    expect(reason([subscription({ visitsLeft: 0 })], "2026-11-02", 2)).toBe("no_visits_left");
    expect(reason([subscription()], "2026-11-02", 2)).toBe("subscription_tanks_exceeded");
  });

  it("uses the renewal for a booking after the current period", () => {
    const renewal = subscription({
      id: "next",
      state: "upcoming",
      startsOn: "2027-10-02",
      endsOn: "2028-10-01",
    });
    const coverage = coverageFor([subscription(), renewal], HOME, "2027-10-05", 1);
    expect(coverage.status === "usable" && coverage.subscription.id).toBe("next");
  });
});

describe("errors", () => {
  it("maps request_subscription's codes", () => {
    expect(requestSubscriptionErrorFor("ZL035")).toBe("exists");
    expect(requestSubscriptionErrorFor("ZL037")).toBe("notOffered");
    expect(requestSubscriptionErrorFor("ZL001")).toBe("outsideArea");
    expect(requestSubscriptionErrorFor("P0002")).toBe("stale");
    expect(requestSubscriptionErrorFor("XX000")).toBe("failed");
  });

  it("reads ZL034's reason for Checkout, A2 and A7", () => {
    expect(bookingErrorFor("ZL034", "no_visits_left")).toBe("no_visits_left");
    expect(bookingErrorFor("ZL034", "something")).toBe("no_subscription");
    expect(isSubscriptionError("subscription_tanks_exceeded")).toBe(true);
    expect(isSubscriptionError("slot_full")).toBe(false);
    expect(adminOrderErrorFor({ code: "ZL034", message: "outside_subscription_period" })).toBe(
      "outside_subscription_period",
    );
    expect(adminEditErrorFor({ code: "ZL034", message: "no_visits_left" })).toBe("no_visits_left");
    expect(adminEditErrorFor({ code: "ZL035" })).toBe("subscription_exists");
    expect(adminEditErrorFor({ code: "ZL036" })).toBe("invalid_subscription_status");
    expect(adminEditErrorFor({ code: "ZL038" })).toBe("subscription_change_not_allowed");
    expect(adminEditErrorFor({ code: "ZL011", message: "reason_required" })).toBe(
      "reason_required",
    );
    expect(adminEditErrorFor({ code: "22023", message: "invalid_adjustment" })).toBe(
      "invalid_adjustment",
    );
  });
});

describe("schemas", () => {
  it("checks A7's activation and adjustments, and A13's plan", () => {
    const activation = {
      subscriptionId: HOME,
      startsOn: "2026-10-28",
      visits: 2,
      tanks: 1,
      priceIqd: 60000,
      paid: false,
      note: "  ",
    };
    expect(activateSubscriptionSchema.parse(activation).note).toBe("");
    expect(activateSubscriptionSchema.safeParse({ ...activation, visits: 0 }).success).toBe(false);
    expect(activateSubscriptionSchema.safeParse({ ...activation, priceIqd: 0 }).success).toBe(
      false,
    );
    const adjust = { subscriptionId: HOME, delta: 1, reason: " زيارة " };
    expect(adjustSubscriptionVisitsSchema.parse(adjust).reason).toBe("زيارة");
    expect(adjustSubscriptionVisitsSchema.safeParse({ ...adjust, delta: 0 }).success).toBe(false);
    expect(adjustSubscriptionVisitsSchema.safeParse({ ...adjust, reason: " " }).success).toBe(
      false,
    );
    const plan = { subscription_price_iqd: null, subscription_visits: 2, subscription_tanks: 1 };
    expect(subscriptionPlanSchema.safeParse(plan).success).toBe(true);
    expect(subscriptionPlanSchema.safeParse({ ...plan, subscription_visits: 13 }).success).toBe(
      false,
    );
  });
});
