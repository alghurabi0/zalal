import { z } from "zod";

import { routes } from "@/lib/routes";

import { ADMIN_ORDERS_MAX, ADMIN_ORDERS_PAGE, pageSizeSchema } from "./orders-query";

// A6's search, sort and open drawer, kept in the URL like A5's. Bad values
// fall back to the defaults instead of failing the page.

/** Matches admin_customers()'s p_sort. */
export const CUSTOMER_SORTS = ["newest", "most_orders"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export const ADMIN_CUSTOMERS_PAGE = ADMIN_ORDERS_PAGE;

export const adminCustomersQuerySchema = z.object({
  /** A name or phone digits. */
  q: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(60))
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined)),
  sort: z.enum(CUSTOMER_SORTS).catch("newest").default("newest"),
  n: pageSizeSchema(ADMIN_CUSTOMERS_PAGE, ADMIN_ORDERS_MAX),
  customer: z.uuid().optional().catch(undefined),
});

export type AdminCustomersQuery = z.output<typeof adminCustomersQuerySchema>;

export function parseAdminCustomersQuery(
  params: Record<string, string | string[] | undefined>,
): AdminCustomersQuery {
  return adminCustomersQuerySchema.parse(
    Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    ),
  );
}

export function adminCustomersHref(query: Partial<AdminCustomersQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.sort && query.sort !== "newest") params.set("sort", query.sort);
  if (query.n && query.n !== ADMIN_CUSTOMERS_PAGE) params.set("n", String(query.n));
  if (query.customer) params.set("customer", query.customer);
  const search = params.toString();
  return search ? `${routes.adminCustomers}?${search}` : routes.adminCustomers;
}
