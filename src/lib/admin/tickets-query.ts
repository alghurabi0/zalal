import { z } from "zod";

import { routes } from "@/lib/routes";

import { ADMIN_ORDERS_MAX, ADMIN_ORDERS_PAGE, pageSizeSchema } from "./orders-query";
import { TICKET_STATUSES } from "@/lib/tickets/format";

// A5's and A12's filters and the open drawer, kept in the URL so a filtered
// list can be shared and survives a reload. Bad values fall back to the
// defaults instead of failing the page.

/** "active" = open and in progress (the default view). */
export const TICKET_STATUS_FILTERS = ["active", "all", ...TICKET_STATUSES] as const;
export type TicketStatusFilter = (typeof TICKET_STATUS_FILTERS)[number];

export const TICKET_SOURCE_FILTERS = ["all", "app", "rating"] as const;
export type TicketSourceFilter = (typeof TICKET_SOURCE_FILTERS)[number];

/** The same paging as A2's list. */
export const ADMIN_LIST_PAGE = ADMIN_ORDERS_PAGE;
const pageSize = pageSizeSchema(ADMIN_ORDERS_PAGE, ADMIN_ORDERS_MAX);

const firstValues = (params: Record<string, string | string[] | undefined>) =>
  Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );

export const adminTicketsQuerySchema = z.object({
  status: z.enum(TICKET_STATUS_FILTERS).catch("active").default("active"),
  source: z.enum(TICKET_SOURCE_FILTERS).catch("all").default("all"),
  /** A ticket number (1024 or ZL-T-1024), a name or phone digits. */
  q: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(60))
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined)),
  n: pageSize,
  ticket: z.uuid().optional().catch(undefined),
});

export type AdminTicketsQuery = z.output<typeof adminTicketsQuerySchema>;

export function parseAdminTicketsQuery(
  params: Record<string, string | string[] | undefined>,
): AdminTicketsQuery {
  return adminTicketsQuerySchema.parse(firstValues(params));
}

export function adminTicketsHref(query: Partial<AdminTicketsQuery>): string {
  const params = new URLSearchParams();
  if (query.status && query.status !== "active") params.set("status", query.status);
  if (query.source && query.source !== "all") params.set("source", query.source);
  if (query.q) params.set("q", query.q);
  if (query.n && query.n !== ADMIN_LIST_PAGE) params.set("n", String(query.n));
  if (query.ticket) params.set("ticket", query.ticket);
  const search = params.toString();
  return search ? `${routes.adminTickets}?${search}` : routes.adminTickets;
}

/** The ticket number in a search ("1024", "zl-t-1024"), or null. */
export function ticketNumberIn(search: string): number | null {
  const match = /^(?:zl-t-)?(\d{1,9})$/i.exec(search.trim());
  return match ? Number(match[1]) : null;
}

export const adminRatingsQuerySchema = z.object({
  stars: z.coerce.number().int().min(1).max(5).optional().catch(undefined),
  n: pageSize,
});

export type AdminRatingsQuery = z.output<typeof adminRatingsQuerySchema>;

export function parseAdminRatingsQuery(
  params: Record<string, string | string[] | undefined>,
): AdminRatingsQuery {
  return adminRatingsQuerySchema.parse(firstValues(params));
}

export function adminRatingsHref(query: Partial<AdminRatingsQuery>): string {
  const params = new URLSearchParams();
  if (query.stars) params.set("stars", String(query.stars));
  if (query.n && query.n !== ADMIN_LIST_PAGE) params.set("n", String(query.n));
  const search = params.toString();
  return search ? `${routes.adminRatings}?${search}` : routes.adminRatings;
}

/** The average of per-star counts, to one decimal; null with no ratings. */
export function ratingAverage(counts: { stars: number; ratings: number }[]): number | null {
  const total = counts.reduce((sum, row) => sum + row.ratings, 0);
  if (total === 0) return null;
  const sum = counts.reduce((acc, row) => acc + row.stars * row.ratings, 0);
  return Math.round((sum / total) * 10) / 10;
}
