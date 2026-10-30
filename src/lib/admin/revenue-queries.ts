import "server-only";

import { createClient } from "@/lib/supabase/server";

import { monthRange } from "./calendar";

// Reads for revenue and debts (spec §8.3; Phase 7, task 2), made as the
// admin: RLS and the views' admin filter give admins every payment,
// discount, manual sale and receivable, and nobody else any. Pages call
// requireViewer(…, "admin") first.

type Voidable = {
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
};

export type ReceivableKind = "order" | "subscription" | "sale";

/** One item in the books (finance_receivables): what it's worth and what was paid. */
export type Receivable = {
  kind: ReceivableKind;
  orderId: string | null;
  orderNumber: number | null;
  subscriptionId: string | null;
  saleId: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  service: string | null;
  /** The item's day in the books; null while it isn't revenue. */
  revenueOn: string | null;
  counted: boolean;
  totalIqd: number;
  /** The amount in the books: 0 while it isn't revenue. */
  amountIqd: number;
  discountIqd: number;
  paidIqd: number;
  /** Above 0 the customer owes it; below 0 it's their credit. */
  balanceIqd: number;
};

type ReceivableRow = {
  kind: string | null;
  order_id: string | null;
  order_number: number | null;
  subscription_id: string | null;
  sale_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  service: string | null;
  revenue_on: string | null;
  counted: boolean | null;
  total_iqd: number | null;
  amount_iqd: number | null;
  discount_iqd: number | null;
  paid_iqd: number | null;
  balance_iqd: number | null;
};

const toReceivable = (row: ReceivableRow): Receivable => ({
  kind: (row.kind ?? "order") as ReceivableKind,
  orderId: row.order_id,
  orderNumber: row.order_number,
  subscriptionId: row.subscription_id,
  saleId: row.sale_id,
  customerId: row.customer_id,
  customerName: row.customer_name,
  customerPhone: row.customer_phone,
  service: row.service,
  revenueOn: row.revenue_on,
  counted: row.counted ?? false,
  totalIqd: Number(row.total_iqd ?? 0),
  amountIqd: Number(row.amount_iqd ?? 0),
  discountIqd: Number(row.discount_iqd ?? 0),
  paidIqd: Number(row.paid_iqd ?? 0),
  balanceIqd: Number(row.balance_iqd ?? 0),
});

export type Payment = Voidable & {
  id: string;
  paidOn: string;
  orderId: string | null;
  orderNumber: number | null;
  subscriptionId: string | null;
  saleId: string | null;
  /** Who the item is for: the order's or subscription's customer, or the sale's name. */
  customerName: string | null;
  accountId: string;
  amountIqd: number;
  automatic: boolean;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
};

const PAYMENT_COLUMNS =
  "id, paid_on, order_id, subscription_id, sale_id, account_id, amount_iqd, automatic, note, " +
  "created_at, voided_at, void_reason, " +
  "order:orders(number, customer:profiles!orders_customer_id_fkey(full_name)), " +
  "subscription:subscriptions(customer:profiles!subscriptions_user_id_fkey(full_name)), " +
  "sale:manual_sales(customer_name), " +
  "creator:profiles!finance_payments_created_by_fkey(full_name), " +
  "voider:profiles!finance_payments_voided_by_fkey(full_name)";

type PaymentRow = {
  id: string;
  paid_on: string;
  order_id: string | null;
  subscription_id: string | null;
  sale_id: string | null;
  account_id: string;
  amount_iqd: number;
  automatic: boolean;
  note: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  order: { number: number; customer: { full_name: string | null } | null } | null;
  subscription: { customer: { full_name: string | null } | null } | null;
  sale: { customer_name: string } | null;
  creator: { full_name: string | null } | null;
  voider: { full_name: string | null } | null;
};

const toPayment = (row: PaymentRow): Payment => ({
  id: row.id,
  paidOn: row.paid_on,
  orderId: row.order_id,
  orderNumber: row.order?.number ?? null,
  subscriptionId: row.subscription_id,
  saleId: row.sale_id,
  customerName:
    row.order?.customer?.full_name ??
    row.subscription?.customer?.full_name ??
    row.sale?.customer_name ??
    null,
  accountId: row.account_id,
  amountIqd: row.amount_iqd,
  automatic: row.automatic,
  note: row.note,
  createdAt: row.created_at,
  createdBy: row.creator?.full_name ?? null,
  voidedAt: row.voided_at,
  voidReason: row.void_reason,
  voidedBy: row.voider?.full_name ?? null,
});

export type Discount = Voidable & {
  id: string;
  orderId: string | null;
  subscriptionId: string | null;
  amountIqd: number;
  reason: string | null;
  createdAt: string;
  createdBy: string | null;
};

export type ManualSale = Voidable & {
  id: string;
  soldOn: string;
  customerName: string;
  customerPhone: string | null;
  service: string;
  place: string | null;
  amountIqd: number;
  crewId: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
};

const SALE_COLUMNS =
  "id, sold_on, customer_name, customer_phone, service, place, amount_iqd, crew_id, note, " +
  "created_at, voided_at, void_reason, " +
  "creator:profiles!manual_sales_created_by_fkey(full_name), " +
  "voider:profiles!manual_sales_voided_by_fkey(full_name)";

type SaleRow = {
  id: string;
  sold_on: string;
  customer_name: string;
  customer_phone: string | null;
  service: string;
  place: string | null;
  amount_iqd: number;
  crew_id: string | null;
  note: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  creator: { full_name: string | null } | null;
  voider: { full_name: string | null } | null;
};

const toSale = (row: SaleRow): ManualSale => ({
  id: row.id,
  soldOn: row.sold_on,
  customerName: row.customer_name,
  customerPhone: row.customer_phone,
  service: row.service,
  place: row.place,
  amountIqd: row.amount_iqd,
  crewId: row.crew_id,
  note: row.note,
  createdAt: row.created_at,
  createdBy: row.creator?.full_name ?? null,
  voidedAt: row.voided_at,
  voidReason: row.void_reason,
  voidedBy: row.voider?.full_name ?? null,
});

export type RevenueSummary = {
  revenueIqd: number;
  discountsIqd: number;
  receivedIqd: number;
  owedIqd: number;
  creditIqd: number;
};

/** The month's revenue, discounts and money in, and what is owed and held as credit now. */
export async function revenueSummary(month: string): Promise<RevenueSummary> {
  const supabase = await createClient();
  const { from, to } = monthRange(month);
  const { data, error } = await supabase
    .rpc("admin_revenue_summary", { p_from: from, p_to: to })
    .single();
  if (error) throw new Error(`Revenue summary read failed: ${error.message}`);
  return {
    revenueIqd: Number(data.revenue_iqd),
    discountsIqd: Number(data.discounts_iqd),
    receivedIqd: Number(data.received_iqd),
    owedIqd: Number(data.owed_iqd),
    creditIqd: Number(data.credit_iqd),
  };
}

export type CustomerBalance = {
  kind: "customer" | "sale";
  customerId: string | null;
  saleId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  items: number;
  amountIqd: number;
  paidIqd: number;
  balanceIqd: number;
  lastRevenueOn: string | null;
};

/**
 * Who owes (balance above 0, largest first) or holds credit (below 0,
 * largest first): the first `n`, and whether there are more.
 */
export async function customerBalances(
  side: "owed" | "credit",
  n: number,
): Promise<{ rows: CustomerBalance[]; more: boolean }> {
  const supabase = await createClient();
  let query = supabase.from("finance_customer_balances").select("*");
  query =
    side === "owed"
      ? query.gt("balance_iqd", 0).order("balance_iqd", { ascending: false })
      : query.lt("balance_iqd", 0).order("balance_iqd", { ascending: true });
  const { data, error } = await query.limit(n + 1);
  if (error) throw new Error(`Customer balances read failed: ${error.message}`);
  return {
    rows: data.slice(0, n).map((row) => ({
      kind: row.kind === "sale" ? "sale" : "customer",
      customerId: row.customer_id,
      saleId: row.sale_id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      items: row.items ?? 0,
      amountIqd: Number(row.amount_iqd ?? 0),
      paidIqd: Number(row.paid_iqd ?? 0),
      balanceIqd: Number(row.balance_iqd ?? 0),
      lastRevenueOn: row.last_revenue_on,
    })),
    more: data.length > n,
  };
}

/** A customer's name and phone, for their account drawer; null when missing. */
export async function customerContact(
  customerId: string,
): Promise<{ name: string | null; phone: string | null } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw new Error(`Customer read failed: ${error.message}`);
  return data ? { name: data.full_name, phone: data.phone } : null;
}

/** A customer's items in the books with a balance, oldest first (at most 30). */
export async function customerReceivables(customerId: string): Promise<Receivable[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finance_receivables")
    .select("*")
    .eq("customer_id", customerId)
    .neq("balance_iqd", 0)
    .order("revenue_on", { ascending: true, nullsFirst: true })
    .limit(30);
  if (error) throw new Error(`Receivables read failed: ${error.message}`);
  return data.map(toReceivable);
}

export type ItemRef =
  | { kind: "order"; id: string }
  | { kind: "subscription"; id: string }
  | { kind: "sale"; id: string };

const itemColumn = { order: "order_id", subscription: "subscription_id", sale: "sale_id" } as const;

/**
 * One item's account: its row in the books (null while it isn't revenue
 * and holds no payment), every payment (voided too, newest first) and its
 * live discount.
 */
export async function itemAccount(item: ItemRef): Promise<{
  receivable: Receivable | null;
  payments: Payment[];
  discount: Discount | null;
  /** An order's status and whether a subscription covers it; null for the other kinds. */
  order: { status: string; covered: boolean } | null;
}> {
  const supabase = await createClient();
  const column = itemColumn[item.kind];
  const [receivable, payments, discount, order] = await Promise.all([
    supabase.from("finance_receivables").select("*").eq(column, item.id).maybeSingle(),
    supabase
      .from("finance_payments")
      .select(PAYMENT_COLUMNS)
      .eq(column, item.id)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
    item.kind === "sale"
      ? Promise.resolve({ data: null, error: null })
      : supabase
          .from("finance_discounts")
          .select(
            "id, order_id, subscription_id, amount_iqd, reason, created_at, voided_at, void_reason, " +
              "creator:profiles!finance_discounts_created_by_fkey(full_name)",
          )
          .eq(item.kind === "order" ? "order_id" : "subscription_id", item.id)
          .is("voided_at", null)
          .maybeSingle(),
    item.kind === "order"
      ? supabase.from("orders").select("status, subscription_id").eq("id", item.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (order.error) throw new Error(`Order read failed: ${order.error.message}`);
  if (receivable.error) throw new Error(`Receivable read failed: ${receivable.error.message}`);
  if (payments.error) throw new Error(`Payments read failed: ${payments.error.message}`);
  if (discount.error) throw new Error(`Discount read failed: ${discount.error.message}`);
  const d = discount.data as unknown as {
    id: string;
    order_id: string | null;
    subscription_id: string | null;
    amount_iqd: number;
    reason: string | null;
    created_at: string;
    creator: { full_name: string | null } | null;
  } | null;
  return {
    receivable: receivable.data ? toReceivable(receivable.data) : null,
    payments: (payments.data as unknown as PaymentRow[]).map(toPayment),
    discount: d
      ? {
          id: d.id,
          orderId: d.order_id,
          subscriptionId: d.subscription_id,
          amountIqd: d.amount_iqd,
          reason: d.reason,
          createdAt: d.created_at,
          createdBy: d.creator?.full_name ?? null,
          voidedAt: null,
          voidReason: null,
          voidedBy: null,
        }
      : null,
    order: order.data
      ? { status: order.data.status, covered: order.data.subscription_id !== null }
      : null,
  };
}

/** The month's payments, voided ones included (struck out), newest first; the first `n`. */
export async function listPayments(
  month: string,
  n: number,
): Promise<{ payments: Payment[]; more: boolean }> {
  const supabase = await createClient();
  const { from, to } = monthRange(month);
  const { data, error } = await supabase
    .from("finance_payments")
    .select(PAYMENT_COLUMNS)
    .gte("paid_on", from)
    .lte("paid_on", to)
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(n + 1);
  if (error) throw new Error(`Payments read failed: ${error.message}`);
  const rows = data as unknown as PaymentRow[];
  return { payments: rows.slice(0, n).map(toPayment), more: rows.length > n };
}

export async function getPayment(id: string): Promise<Payment | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finance_payments")
    .select(PAYMENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Payment read failed: ${error.message}`);
  return data ? toPayment(data as unknown as PaymentRow) : null;
}

/** The month's manual sales, voided ones included, newest first; the first `n`. */
export async function listManualSales(
  month: string,
  n: number,
): Promise<{ sales: ManualSale[]; more: boolean }> {
  const supabase = await createClient();
  const { from, to } = monthRange(month);
  const { data, error } = await supabase
    .from("manual_sales")
    .select(SALE_COLUMNS)
    .gte("sold_on", from)
    .lte("sold_on", to)
    .order("sold_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(n + 1);
  if (error) throw new Error(`Manual sales read failed: ${error.message}`);
  const rows = data as unknown as SaleRow[];
  return { sales: rows.slice(0, n).map(toSale), more: rows.length > n };
}

export async function getManualSale(id: string): Promise<ManualSale | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("manual_sales")
    .select(SALE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Manual sale read failed: ${error.message}`);
  return data ? toSale(data as unknown as SaleRow) : null;
}
