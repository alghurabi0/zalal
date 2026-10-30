import { z } from "zod";

import type { Database } from "@/lib/database.types";
import { CURRENT_STATUSES } from "@/lib/orders/status";

// A2's filters and the open drawer, kept in the URL so a filtered list can
// be shared and survives a reload: `/admin/orders?status=confirmed&date=
// 2026-10-26&district=حي&crew=<id>&slot=3&n=100&order=<id>`. `from` and `to`
// bound the service day (A1's period cards link with them; either may be
// left open). Bad values fall back to the defaults instead of failing the
// page.

type OrderStatus = Database["public"]["Enums"]["order_status"];

export const ORDER_STATUSES = [
  "pending_confirmation",
  "confirmed",
  "on_the_way",
  "arrived",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
] as const satisfies readonly OrderStatus[];

/**
 * "active" = every status before the end states (the default view);
 * "booked" = every order holding a place (all but cancelled), as the board
 * counts them.
 */
export const STATUS_FILTERS = ["active", "booked", "all", ...ORDER_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** "none" = orders with no crew yet. */
export type CrewFilter = "none" | (string & {});

export const ADMIN_ORDERS_PAGE = 50;
export const ADMIN_ORDERS_MAX = 1000;

const optionalText = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(max))
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined));

/** A list's `n`: how many rows to show, `page` more at a time, at most `max`. */
export function pageSizeSchema(page: number, max: number) {
  return z.coerce
    .number()
    .int()
    .catch(page)
    .default(page)
    .transform((n) => Math.min(max, Math.max(page, n)));
}

export const adminOrdersQuerySchema = z.object({
  status: z.enum(STATUS_FILTERS).catch("active").default("active"),
  date: z.iso.date().optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  district: optionalText(60),
  crew: z
    .union([z.literal("none"), z.uuid()])
    .optional()
    .catch(undefined),
  slot: z.coerce.number().int().positive().optional().catch(undefined),
  n: pageSizeSchema(ADMIN_ORDERS_PAGE, ADMIN_ORDERS_MAX),
  order: z.uuid().optional().catch(undefined),
});

export type AdminOrdersQuery = z.output<typeof adminOrdersQuerySchema>;

/** Reads Next's searchParams (repeated keys keep the first value). */
export function parseAdminOrdersQuery(
  params: Record<string, string | string[] | undefined>,
): AdminOrdersQuery {
  const first = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  return adminOrdersQuerySchema.parse(first);
}

/** The statuses a filter stands for. */
export function statusesFor(filter: StatusFilter): readonly OrderStatus[] {
  if (filter === "active") return CURRENT_STATUSES;
  if (filter === "all") return ORDER_STATUSES;
  if (filter === "booked") return ORDER_STATUSES.filter((s) => s !== "cancelled");
  return [filter];
}

/**
 * Upcoming work reads soonest first (the active view, or a day or a range);
 * everything else newest first.
 */
export function soonestFirst(
  query: Pick<AdminOrdersQuery, "status" | "date" | "from" | "to">,
): boolean {
  if (query.date || query.from || query.to) return true;
  return (
    (CURRENT_STATUSES as readonly string[]).includes(query.status) || query.status === "active"
  );
}

/** The query string for a filter set, leaving out defaults. */
export function adminOrdersHref(query: Partial<AdminOrdersQuery>, base = "/admin/orders"): string {
  const params = new URLSearchParams();
  if (query.status && query.status !== "active") params.set("status", query.status);
  if (query.date) params.set("date", query.date);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.district) params.set("district", query.district);
  if (query.crew) params.set("crew", query.crew);
  if (query.slot) params.set("slot", String(query.slot));
  if (query.n && query.n !== ADMIN_ORDERS_PAGE) params.set("n", String(query.n));
  if (query.order) params.set("order", query.order);
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

/** Escapes LIKE wildcards so a district search matches the text as typed. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Statuses an override can move an order to: any other one. From pending or
 * confirmed, going back to pending is a reschedule (it needs a new slot), so
 * it is left to the reschedule action.
 */
export function overrideTargets(status: OrderStatus): OrderStatus[] {
  const reschedule = status === "pending_confirmation" || status === "confirmed";
  return ORDER_STATUSES.filter(
    (s) => s !== status && !(reschedule && s === "pending_confirmation"),
  );
}

/** Whether the order is still before the end states. */
export function isActive(status: OrderStatus): boolean {
  return (CURRENT_STATUSES as readonly OrderStatus[]).includes(status);
}
