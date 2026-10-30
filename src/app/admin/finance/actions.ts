"use server";

import * as Sentry from "@sentry/nextjs";

import { type AdminEditResult, editFailure } from "@/lib/admin/edit-errors";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import {
  type ExpenseCategoryInput,
  expenseCategorySchema,
  type ExpenseInput,
  expenseSchema,
  type FinanceAccountInput,
  financeAccountSchema,
  type FinanceSettingsInput,
  financeSettingsSchema,
  type TransferInput,
  transferSchema,
  type VoidInput,
  voidSchema,
} from "@/lib/schemas/finance";
import { createClient } from "@/lib/supabase/server";

// The accounting actions (spec §8.3 A15–A17), as the admin: the audited
// admin RPCs check the role, the day, switched-off boxes and categories and
// voided records, and write the audit log.

const report = (message: string) => Sentry.captureMessage(message, "error");

async function admin(page: string) {
  await requireViewer(page, "admin");
  return createClient();
}

const invalid = { status: "error", error: "invalid" } as const;

export async function saveExpense(input: ExpenseInput): Promise<AdminEditResult> {
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminExpenses);
  const { id, spentOn, categoryId, accountId, amountIqd, note } = parsed.data;
  const { error } = await supabase.rpc("admin_save_expense", {
    p_id: id ?? undefined,
    p_spent_on: spentOn,
    p_category_id: categoryId,
    p_account_id: accountId,
    p_amount_iqd: amountIqd,
    p_note: note === "" ? undefined : note,
  });
  return error ? editFailure("admin_save_expense", error, report) : { status: "done" };
}

export async function voidExpense(input: VoidInput): Promise<AdminEditResult> {
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminExpenses);
  const { error } = await supabase.rpc("admin_void_expense", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  return error ? editFailure("admin_void_expense", error, report) : { status: "done" };
}

export async function saveTransfer(input: TransferInput): Promise<AdminEditResult> {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminFinance);
  const { id, movedOn, fromAccountId, toAccountId, amountIqd, note } = parsed.data;
  const { error } = await supabase.rpc("admin_save_transfer", {
    p_id: id ?? undefined,
    p_moved_on: movedOn,
    p_from_account_id: fromAccountId,
    p_to_account_id: toAccountId,
    p_amount_iqd: amountIqd,
    p_note: note === "" ? undefined : note,
  });
  return error ? editFailure("admin_save_transfer", error, report) : { status: "done" };
}

export async function voidTransfer(input: VoidInput): Promise<AdminEditResult> {
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminFinance);
  const { error } = await supabase.rpc("admin_void_transfer", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  return error ? editFailure("admin_void_transfer", error, report) : { status: "done" };
}

export async function saveFinanceAccount(input: FinanceAccountInput): Promise<AdminEditResult> {
  const parsed = financeAccountSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminFinanceSettings);
  const { id, kind, name, openingBalanceIqd, active } = parsed.data;
  const { error } = await supabase.rpc("admin_save_finance_account", {
    p_id: id ?? undefined,
    p_kind: kind ?? undefined,
    p_name: name ?? undefined,
    p_opening_balance_iqd: openingBalanceIqd,
    p_active: active,
  });
  return error ? editFailure("admin_save_finance_account", error, report) : { status: "done" };
}

export async function saveExpenseCategory(input: ExpenseCategoryInput): Promise<AdminEditResult> {
  const parsed = expenseCategorySchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminFinanceSettings);
  const { id, name, kind, active } = parsed.data;
  const { error } = await supabase.rpc("admin_save_expense_category", {
    p_id: id ?? undefined,
    p_name: name,
    p_kind: kind,
    p_active: active,
  });
  return error ? editFailure("admin_save_expense_category", error, report) : { status: "done" };
}

export async function deleteExpenseCategory(id: number): Promise<AdminEditResult> {
  if (!Number.isInteger(id) || id <= 0) return invalid;
  const supabase = await admin(routes.adminFinanceSettings);
  const { error } = await supabase.rpc("admin_delete_expense_category", { p_id: id });
  return error ? editFailure("admin_delete_expense_category", error, report) : { status: "done" };
}

export async function saveFinanceSettings(input: FinanceSettingsInput): Promise<AdminEditResult> {
  const parsed = financeSettingsSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminFinanceSettings);
  const { error } = await supabase.rpc("admin_update_finance_settings", {
    p_start_on: parsed.data.startOn,
  });
  return error ? editFailure("admin_update_finance_settings", error, report) : { status: "done" };
}
