import "server-only";

import { createClient } from "@/lib/supabase/server";

import { expenseCategories } from "./finance-queries";
import type { AdminReportsQuery } from "./finance-query";
import {
  type CategoryTotal,
  type MonthReport,
  type ReportLine,
  reportLines,
} from "./finance-reports";

// Reads for the accounting overview and reports (spec §8.3 A19–A20), made
// as the admin: both functions refuse anyone else (42501).

/** "2026-10-01" → "2026-10" */
const monthOf = (day: string) => day.slice(0, 7);

/** Each month from `from` to `to` ("2026-01" … "2026-12", at most 24). */
export async function profitAndLoss(from: string, to: string): Promise<MonthReport[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_profit_and_loss", {
    p_from: `${from}-01`,
    p_to: `${to}-01`,
  });
  if (error) throw new Error(`Profit and loss read failed: ${error.code}`);
  return data.map((row) => ({
    month: monthOf(row.month),
    ordersIqd: Number(row.orders_iqd),
    subscriptionsIqd: Number(row.subscriptions_iqd),
    salesIqd: Number(row.sales_iqd),
    discountsIqd: Number(row.discounts_iqd),
    revenueIqd: Number(row.revenue_iqd),
    expensesIqd: Number(row.expenses_iqd),
    profitIqd: Number(row.profit_iqd),
    receivedIqd: Number(row.received_iqd),
    refundedIqd: Number(row.refunded_iqd),
    netCashIqd: Number(row.net_cash_iqd),
    closed: row.closed,
  }));
}

/** Each month's expenses by category, from `from` to `to`. */
export async function expensesByCategory(from: string, to: string): Promise<CategoryTotal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_expenses_by_category", {
    p_from: `${from}-01`,
    p_to: `${to}-01`,
  });
  if (error) throw new Error(`Expenses by category read failed: ${error.code}`);
  return data.map((row) => ({
    month: monthOf(row.month),
    categoryId: Number(row.category_id),
    totalIqd: Number(row.total_iqd),
  }));
}

/**
 * A20's report, for the page and its CSV alike: the year asked for, or the
 * month (this month by default), neither past today in Baghdad.
 */
export async function loadReport(
  query: AdminReportsQuery,
  today: string,
): Promise<{ year: string | null; month: string; months: MonthReport[]; lines: ReportLine[] }> {
  const thisMonth = today.slice(0, 7);
  const year = query.year && query.year <= today.slice(0, 4) ? query.year : null;
  const month = !year && query.month && query.month <= thisMonth ? query.month : thisMonth;
  const [from, to] = year ? [`${year}-01`, `${year}-12`] : [month, month];
  const [months, byCategory, categories] = await Promise.all([
    profitAndLoss(from, to),
    expensesByCategory(from, to),
    expenseCategories(),
  ]);
  const names = new Map(categories.map((category) => [category.id, category.name]));
  return { year, month, months, lines: reportLines(months, byCategory, names) };
}
