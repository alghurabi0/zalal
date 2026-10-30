import "server-only";

import type { ExpenseCategoryKind, FinanceAccountKind } from "@/lib/schemas/finance";
import { createClient } from "@/lib/supabase/server";

import { monthRange } from "./calendar";
import type { AdminExpensesQuery } from "./finance-query";

// Reads for the accounting screens (spec §8.3 A15–A17), made as the admin:
// RLS lets admins read every box, category, expense and transfer, and nobody
// else any. Pages call requireViewer(…, "admin") first.

export type FinanceAccount = {
  id: string;
  kind: FinanceAccountKind;
  /** The box's own name; null for a crew box, which shows `crewName`. */
  name: string | null;
  crewName: string | null;
  openingBalanceIqd: number;
  active: boolean;
  /** Opening balance + transfers in − transfers out − expenses (voided left out). */
  balanceIqd: number;
};

const KIND_ORDER: Record<FinanceAccountKind, number> = { cash: 0, zain_cash: 1, bank: 2, crew: 3 };

/** Every box with its balance: switched-on first, then cash, Zain Cash, banks, crews. */
export async function financeAccounts(): Promise<FinanceAccount[]> {
  const supabase = await createClient();
  const [accounts, balances] = await Promise.all([
    supabase
      .from("finance_accounts")
      .select("id, kind, name, opening_balance_iqd, active, crew:crews(name)"),
    supabase.from("finance_account_balances").select("account_id, balance_iqd"),
  ]);
  if (accounts.error) throw new Error(`Boxes read failed: ${accounts.error.message}`);
  if (balances.error) throw new Error(`Balances read failed: ${balances.error.message}`);
  const balanceOf = new Map(balances.data.map((row) => [row.account_id, row.balance_iqd]));

  return accounts.data
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      crewName: row.crew?.name ?? null,
      openingBalanceIqd: row.opening_balance_iqd,
      active: row.active,
      balanceIqd: Number(balanceOf.get(row.id) ?? row.opening_balance_iqd),
    }))
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (a.name ?? a.crewName ?? "").localeCompare(b.name ?? b.crewName ?? "", "ar"),
    );
}

export type ExpenseCategory = {
  id: number;
  name: string;
  kind: ExpenseCategoryKind;
  active: boolean;
};

/** Every category in the order they were added (the migration's nine first). */
export async function expenseCategories(): Promise<ExpenseCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expense_categories")
    .select("id, name, kind, active")
    .order("id");
  if (error) throw new Error(`Expense categories read failed: ${error.message}`);
  return data;
}

/** The day the books start ("2026-11-01"). */
export async function financeStartOn(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("finance_settings").select("start_on").single();
  if (error) throw new Error(`Finance settings read failed: ${error.message}`);
  return data.start_on;
}

type Voidable = {
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
};

export type Expense = Voidable & {
  id: string;
  spentOn: string;
  categoryId: number;
  accountId: string;
  amountIqd: number;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
};

const EXPENSE_COLUMNS =
  "id, spent_on, category_id, account_id, amount_iqd, note, created_at, voided_at, void_reason, " +
  "creator:profiles!expenses_created_by_fkey(full_name), voider:profiles!expenses_voided_by_fkey(full_name)";

type ExpenseRow = {
  id: string;
  spent_on: string;
  category_id: number;
  account_id: string;
  amount_iqd: number;
  note: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  creator: { full_name: string | null } | null;
  voider: { full_name: string | null } | null;
};

const toExpense = (row: ExpenseRow): Expense => ({
  id: row.id,
  spentOn: row.spent_on,
  categoryId: row.category_id,
  accountId: row.account_id,
  amountIqd: row.amount_iqd,
  note: row.note,
  createdAt: row.created_at,
  createdBy: row.creator?.full_name ?? null,
  voidedAt: row.voided_at,
  voidReason: row.void_reason,
  voidedBy: row.voider?.full_name ?? null,
});

// PostgREST returns at most 1,000 rows a request; totals read the amounts
// in pages of this size.
const SUM_PAGE = 1000;

/**
 * The month's expenses for A16, newest day first: the first `n` (and
 * whether there are more) and the total of every one the filters match.
 */
export async function listExpenses(
  query: AdminExpensesQuery,
  month: string,
): Promise<{ expenses: Expense[]; more: boolean; total: number; count: number }> {
  const supabase = await createClient();
  const { from, to } = monthRange(month);
  // The same filters for the page and for the total.
  const select = (columns: string) => {
    let builder = supabase
      .from("expenses")
      .select(columns)
      .gte("spent_on", from)
      .lte("spent_on", to);
    builder = query.voided ? builder.not("voided_at", "is", null) : builder.is("voided_at", null);
    if (query.category) builder = builder.eq("category_id", query.category);
    if (query.account) builder = builder.eq("account_id", query.account);
    // PostgREST reads * as %, so it goes too.
    const words = query.q?.replace(/\*/g, "").replace(/[%_\\]/g, "\\$&");
    if (words) builder = builder.ilike("note", `%${words}%`);
    return builder;
  };

  const { data, error } = await select(EXPENSE_COLUMNS)
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(query.n + 1);
  if (error) throw new Error(`Expenses read failed: ${error.message}`);
  const rows = data as unknown as ExpenseRow[];

  let total = 0;
  let count = 0;
  for (let start = 0; ; start += SUM_PAGE) {
    const amounts = await select("amount_iqd")
      .order("id")
      .range(start, start + SUM_PAGE - 1);
    if (amounts.error) throw new Error(`Expense totals read failed: ${amounts.error.message}`);
    const page = amounts.data as unknown as { amount_iqd: number }[];
    for (const row of page) total += row.amount_iqd;
    count += page.length;
    if (page.length < SUM_PAGE) break;
  }

  return {
    expenses: rows.slice(0, query.n).map(toExpense),
    more: rows.length > query.n,
    total,
    count,
  };
}

export async function getExpense(id: string): Promise<Expense | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select(EXPENSE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Expense read failed: ${error.message}`);
  return data ? toExpense(data as unknown as ExpenseRow) : null;
}

export type Transfer = Voidable & {
  id: string;
  movedOn: string;
  fromAccountId: string;
  toAccountId: string;
  amountIqd: number;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
};

const TRANSFER_COLUMNS =
  "id, moved_on, from_account_id, to_account_id, amount_iqd, note, created_at, voided_at, void_reason, " +
  "creator:profiles!finance_transfers_created_by_fkey(full_name), " +
  "voider:profiles!finance_transfers_voided_by_fkey(full_name)";

type TransferRow = Omit<ExpenseRow, "spent_on" | "category_id" | "account_id"> & {
  moved_on: string;
  from_account_id: string;
  to_account_id: string;
};

const toTransfer = (row: TransferRow): Transfer => ({
  id: row.id,
  movedOn: row.moved_on,
  fromAccountId: row.from_account_id,
  toAccountId: row.to_account_id,
  amountIqd: row.amount_iqd,
  note: row.note,
  createdAt: row.created_at,
  createdBy: row.creator?.full_name ?? null,
  voidedAt: row.voided_at,
  voidReason: row.void_reason,
  voidedBy: row.voider?.full_name ?? null,
});

/** The month's transfers, voided ones included (A15 shows them struck out), newest first. */
export async function listTransfers(month: string): Promise<Transfer[]> {
  const supabase = await createClient();
  const { from, to } = monthRange(month);
  const { data, error } = await supabase
    .from("finance_transfers")
    .select(TRANSFER_COLUMNS)
    .gte("moved_on", from)
    .lte("moved_on", to)
    .order("moved_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Transfers read failed: ${error.message}`);
  return (data as unknown as TransferRow[]).map(toTransfer);
}

export async function getTransfer(id: string): Promise<Transfer | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finance_transfers")
    .select(TRANSFER_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Transfer read failed: ${error.message}`);
  return data ? toTransfer(data as unknown as TransferRow) : null;
}
