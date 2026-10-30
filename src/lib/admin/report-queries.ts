import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { CategoryTotal, MonthReport } from "./finance-reports";

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
