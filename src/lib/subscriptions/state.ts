import type { Database } from "@/lib/database.types";
import { addDays, addMonths, baghdadToday } from "@/lib/dates";

// The annual subscription (spec N8, §5.8, §5.11; Phase 6, task 2): one per
// address, settled Oct 28, 2026. The database counts the visits
// (subscription_overview) and enforces every rule; these pure helpers decide
// what the screens show, and are unit-tested.

export const SUBSCRIPTION_STATES = [
  "requested",
  "upcoming",
  "active",
  "expired",
  "declined",
  "cancelled",
] as const;

export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/** request_subscription takes a renewal from this many days before the end. */
export const RENEW_DAYS = 30;

export type OverviewRow = Database["public"]["Views"]["subscription_overview"]["Row"];

/** The columns the screens read from subscription_overview. */
export const OVERVIEW_COLUMNS =
  "id, user_id, address_id, state, requested_at, activated_at, ended_at, price_iqd, visits_total, tanks_covered, starts_on, ends_on, paid, visits_adjustment, visits_used, visits_held, visits_left, next_order_id, next_order_at, last_visit_on, address_label, address_district, address_landmark, customer_name, customer_phone";

export type Subscription = {
  id: string;
  userId: string;
  addressId: string;
  state: SubscriptionState;
  requestedAt: string;
  activatedAt: string | null;
  endedAt: string | null;
  priceIqd: number | null;
  visitsTotal: number;
  tanksCovered: number;
  startsOn: string | null;
  endsOn: string | null;
  paid: boolean;
  visitsUsed: number;
  visitsHeld: number;
  visitsLeft: number;
  nextOrderId: string | null;
  nextOrderAt: string | null;
  lastVisitOn: string | null;
  address: {
    label: Database["public"]["Enums"]["address_label"];
    district: string;
    landmark: string;
  } | null;
  customer: { name: string | null; phone: string | null };
};

const isState = (value: string | null): value is SubscriptionState =>
  SUBSCRIPTION_STATES.some((state) => state === value);

export function toSubscription(row: Omit<OverviewRow, "status">): Subscription {
  return {
    id: row.id,
    userId: row.user_id,
    addressId: row.address_id,
    state: isState(row.state) ? row.state : "requested",
    requestedAt: row.requested_at,
    activatedAt: row.activated_at,
    endedAt: row.ended_at,
    priceIqd: row.price_iqd,
    visitsTotal: row.visits_total ?? 0,
    tanksCovered: row.tanks_covered ?? 0,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    paid: row.paid,
    visitsUsed: row.visits_used ?? 0,
    visitsHeld: row.visits_held ?? 0,
    visitsLeft: row.visits_left ?? 0,
    nextOrderId: row.next_order_id,
    nextOrderAt: row.next_order_at,
    lastVisitOn: row.last_visit_on,
    address:
      row.address_label && row.address_district !== null && row.address_landmark !== null
        ? {
            label: row.address_label,
            district: row.address_district,
            landmark: row.address_landmark,
          }
        : null,
    customer: { name: row.customer_name, phone: row.customer_phone },
  };
}

const LIVE: SubscriptionState[] = ["active", "upcoming", "requested"];

/**
 * The subscription an address shows (N8, the Profile card): the one running
 * now, else the next one, else the request, else the latest that ended.
 * Rows of other addresses are ignored.
 */
export function currentFor(subscriptions: Subscription[], addressId: string): Subscription | null {
  const mine = subscriptions.filter((s) => s.addressId === addressId);
  for (const state of LIVE) {
    const found = mine
      .filter((s) => s.state === state)
      .sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? ""))[0];
    if (found) return found;
  }
  return mine.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0] ?? null;
}

/** A renewal asked for while the current one still runs. */
export function hasRenewal(subscriptions: Subscription[], current: Subscription | null): boolean {
  if (!current || (current.state !== "active" && current.state !== "upcoming")) return false;
  return subscriptions.some(
    (s) =>
      s.addressId === current.addressId &&
      s.id !== current.id &&
      (s.state === "requested" || s.state === "upcoming"),
  );
}

/**
 * Whether "اطلب الاشتراك" shows for an address: no request yet, and nothing
 * active that ends more than RENEW_DAYS from today (request_subscription's
 * rule, ZL035).
 */
export function canRequest(
  subscriptions: Subscription[],
  addressId: string,
  now: Date = new Date(),
): boolean {
  const limit = addDays(baghdadToday(now), RENEW_DAYS);
  return !subscriptions.some(
    (s) =>
      s.addressId === addressId &&
      (s.state === "requested" ||
        ((s.state === "active" || s.state === "upcoming") && (s.endsOn ?? "") > limit)),
  );
}

export type NextVisit =
  { kind: "booked"; orderId: string; at: string } | { kind: "due"; day: string } | null;

/**
 * "الزيارة الجاية" (Profile, settled Oct 28, 2026): the soonest open covered
 * order; else when the next cleaning is due (the last covered visit plus the
 * cleaning interval, or the start when none is used yet), today at the
 * earliest; nothing once no visit is left or the due day is past the end.
 */
export function nextVisit(
  subscription: Subscription,
  intervalMonths: number,
  now: Date = new Date(),
): NextVisit {
  if (subscription.nextOrderId && subscription.nextOrderAt) {
    return { kind: "booked", orderId: subscription.nextOrderId, at: subscription.nextOrderAt };
  }
  if (subscription.visitsLeft <= 0 || !subscription.startsOn || !subscription.endsOn) return null;
  const today = baghdadToday(now);
  const due = subscription.lastVisitOn
    ? baghdadToday(addMonths(`${subscription.lastVisitOn}T12:00:00+03:00`, intervalMonths))
    : subscription.startsOn;
  const day = due < today ? today : due;
  return day > subscription.endsOn ? null : { kind: "due", day };
}

export type CoverageProblem =
  "outside_subscription_period" | "no_visits_left" | "subscription_tanks_exceeded";

export type Coverage =
  | { status: "none" }
  | { status: "usable"; subscription: Subscription }
  | { status: "blocked"; reason: CoverageProblem; subscription: Subscription };

/**
 * Checkout's toggle (§5.11): whether the address's subscription can cover a
 * booking on serviceDate with this many tanks. The same checks as
 * create_order, in the same order; the database has the last word (ZL034).
 */
export function coverageFor(
  subscriptions: Subscription[],
  addressId: string,
  serviceDate: string | null,
  tanks: number,
): Coverage {
  const running = subscriptions.filter(
    (s) => s.addressId === addressId && (s.state === "active" || s.state === "upcoming"),
  );
  if (running.length === 0) return { status: "none" };
  const covering = running.find(
    (s) =>
      serviceDate !== null &&
      s.startsOn !== null &&
      s.endsOn !== null &&
      serviceDate >= s.startsOn &&
      serviceDate <= s.endsOn,
  );
  if (!covering) {
    return { status: "blocked", reason: "outside_subscription_period", subscription: running[0]! };
  }
  if (covering.visitsLeft <= 0) {
    return { status: "blocked", reason: "no_visits_left", subscription: covering };
  }
  if (tanks > covering.tanksCovered) {
    return { status: "blocked", reason: "subscription_tanks_exceeded", subscription: covering };
  }
  return { status: "usable", subscription: covering };
}
