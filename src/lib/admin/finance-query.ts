import { z } from "zod";

import { routes } from "@/lib/routes";

import { ADMIN_ORDERS_MAX, ADMIN_ORDERS_PAGE, pageSizeSchema } from "./orders-query";

// The accounting screens' month, filters and open drawer, kept in the URL so
// a list can be shared and survives a reload (spec §8.3). Bad values fall
// back to the defaults; no month means the month under way in Baghdad.

export const ADMIN_EXPENSES_PAGE = ADMIN_ORDERS_PAGE;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const firstValues = (params: Record<string, string | string[] | undefined>) =>
  Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );

const monthSchema = z.string().regex(MONTH).optional().catch(undefined);
/** A drawer: "new", or the id of the record to edit. */
const drawerSchema = z
  .union([z.literal("new"), z.uuid()])
  .optional()
  .catch(undefined);

export const adminExpensesQuerySchema = z.object({
  month: monthSchema,
  category: z.coerce.number().int().positive().optional().catch(undefined),
  account: z.uuid().optional().catch(undefined),
  /** Words in the note. */
  q: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(60))
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined)),
  /** "1" lists the voided expenses instead. */
  voided: z
    .literal("1")
    .optional()
    .catch(undefined)
    .transform((value) => value === "1"),
  n: pageSizeSchema(ADMIN_EXPENSES_PAGE, ADMIN_ORDERS_MAX),
  expense: drawerSchema,
});

export type AdminExpensesQuery = z.output<typeof adminExpensesQuerySchema>;

export function parseAdminExpensesQuery(
  params: Record<string, string | string[] | undefined>,
): AdminExpensesQuery {
  return adminExpensesQuerySchema.parse(firstValues(params));
}

export function adminExpensesHref(query: Partial<AdminExpensesQuery>): string {
  const params = new URLSearchParams();
  if (query.month) params.set("month", query.month);
  if (query.category) params.set("category", String(query.category));
  if (query.account) params.set("account", query.account);
  if (query.q) params.set("q", query.q);
  if (query.voided) params.set("voided", "1");
  if (query.n && query.n !== ADMIN_EXPENSES_PAGE) params.set("n", String(query.n));
  if (query.expense) params.set("expense", query.expense);
  const search = params.toString();
  return search ? `${routes.adminExpenses}?${search}` : routes.adminExpenses;
}

export const adminBoxesQuerySchema = z.object({
  /** The month of the transfers listed. */
  month: monthSchema,
  transfer: drawerSchema,
  /** A new transfer from this box (a crew's "استلم المبلغ"). */
  from: z.uuid().optional().catch(undefined),
});

export type AdminBoxesQuery = z.output<typeof adminBoxesQuerySchema>;

export function parseAdminBoxesQuery(
  params: Record<string, string | string[] | undefined>,
): AdminBoxesQuery {
  return adminBoxesQuerySchema.parse(firstValues(params));
}

export function adminBoxesHref(query: Partial<AdminBoxesQuery>): string {
  const params = new URLSearchParams();
  if (query.month) params.set("month", query.month);
  if (query.transfer) params.set("transfer", query.transfer);
  if (query.from) params.set("from", query.from);
  const search = params.toString();
  return search ? `${routes.adminFinance}?${search}` : routes.adminFinance;
}
