import { z } from "zod";

import { routes } from "@/lib/routes";

import { ADMIN_ORDERS_MAX, ADMIN_ORDERS_PAGE, pageSizeSchema } from "./orders-query";

// A7's view, search and open drawer, kept in the URL so a list can be shared
// and survives a reload. Bad values fall back to the defaults.

/** requests first (the queue), then running, ending within 30 days, and the rest. */
export const SUBSCRIPTION_VIEWS = ["requests", "active", "expiring", "ended"] as const;
export type SubscriptionView = (typeof SUBSCRIPTION_VIEWS)[number];

export const ADMIN_SUBSCRIPTIONS_PAGE = ADMIN_ORDERS_PAGE;

const firstValues = (params: Record<string, string | string[] | undefined>) =>
  Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );

export const adminSubscriptionsQuerySchema = z.object({
  view: z.enum(SUBSCRIPTION_VIEWS).catch("requests").default("requests"),
  /** A name or phone digits. */
  q: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(60))
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined)),
  n: pageSizeSchema(ADMIN_ORDERS_PAGE, ADMIN_ORDERS_MAX),
  subscription: z.uuid().optional().catch(undefined),
});

export type AdminSubscriptionsQuery = z.output<typeof adminSubscriptionsQuerySchema>;

export function parseAdminSubscriptionsQuery(
  params: Record<string, string | string[] | undefined>,
): AdminSubscriptionsQuery {
  return adminSubscriptionsQuerySchema.parse(firstValues(params));
}

export function adminSubscriptionsHref(query: Partial<AdminSubscriptionsQuery>): string {
  const params = new URLSearchParams();
  if (query.view && query.view !== "requests") params.set("view", query.view);
  if (query.q) params.set("q", query.q);
  if (query.n && query.n !== ADMIN_SUBSCRIPTIONS_PAGE) params.set("n", String(query.n));
  if (query.subscription) params.set("subscription", query.subscription);
  const search = params.toString();
  return search ? `${routes.adminSubscriptions}?${search}` : routes.adminSubscriptions;
}
