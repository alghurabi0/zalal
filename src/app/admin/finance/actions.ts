"use server";

import * as Sentry from "@sentry/nextjs";

import { type AdminEditResult, editFailure } from "@/lib/admin/edit-errors";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import { normalizeIraqiMobile } from "@/lib/phone";
import {
  type DiscountInput,
  discountSchema,
  type EquipmentDisposalInput,
  equipmentDisposalSchema,
  type ExpenseCategoryInput,
  expenseCategoryIdSchema,
  expenseCategorySchema,
  type ExpenseInput,
  expenseSchema,
  type FinanceAccountInput,
  financeAccountSchema,
  type FinanceSettingsInput,
  financeSettingsSchema,
  type ManualSaleInput,
  manualSaleSchema,
  type MonthCloseInput,
  monthCloseSchema,
  type MonthReopenInput,
  monthReopenSchema,
  type OpeningEquipmentInput,
  openingEquipmentSchema,
  type PartnerInput,
  type PartnerMovementInput,
  partnerMovementSchema,
  partnerSchema,
  type PartnerSharesInput,
  partnerSharesSchema,
  type PaymentInput,
  type PayrollAdjustmentInput,
  payrollAdjustmentSchema,
  payrollIdSchema,
  type PayrollVoidInput,
  payrollVoidSchema,
  paymentSchema,
  type TransferInput,
  transferSchema,
  type VoidInput,
  voidSchema,
  type WorkerDaysInput,
  workerDaysSchema,
  type WorkerInput,
  type WorkerMoveInput,
  workerMoveSchema,
  type WorkerRateInput,
  workerRateSchema,
  workerSchema,
} from "@/lib/schemas/finance";
import {
  type StockItemInput,
  stockItemSchema,
  type StockMoveInput,
  stockMoveSchema,
} from "@/lib/schemas/stock";
import { createClient } from "@/lib/supabase/server";

// The accounting actions (spec §8.3 A15–A23), as the admin: the audited
// admin RPCs check the role, the day, switched-off boxes and categories,
// voided records, refunds and discounts, and write the audit log.

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
  const { id, spentOn, categoryId, accountId, amountIqd, note, workerId, usefulLifeMonths } =
    parsed.data;
  const { error } = await supabase.rpc("admin_save_expense", {
    p_id: id ?? undefined,
    p_spent_on: spentOn,
    p_category_id: categoryId,
    p_account_id: accountId,
    p_amount_iqd: amountIqd,
    p_note: note === "" ? undefined : note,
    p_worker_id: workerId ?? undefined,
    p_useful_life_months: usefulLifeMonths ?? undefined,
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
  const parsed = expenseCategoryIdSchema.safeParse(id);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminFinanceSettings);
  const { error } = await supabase.rpc("admin_delete_expense_category", { p_id: parsed.data });
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

export async function savePayment(input: PaymentInput): Promise<AdminEditResult> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminRevenue);
  const { id, orderId, subscriptionId, saleId, paidOn, accountId, amountIqd, note } = parsed.data;
  const { error } = await supabase.rpc("admin_save_payment", {
    p_id: id ?? undefined,
    p_order_id: orderId ?? undefined,
    p_subscription_id: subscriptionId ?? undefined,
    p_sale_id: saleId ?? undefined,
    p_paid_on: paidOn,
    p_account_id: accountId,
    p_amount_iqd: amountIqd,
    p_note: note === "" ? undefined : note,
  });
  return error ? editFailure("admin_save_payment", error, report) : { status: "done" };
}

export async function voidPayment(input: VoidInput): Promise<AdminEditResult> {
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminRevenue);
  const { error } = await supabase.rpc("admin_void_payment", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  return error ? editFailure("admin_void_payment", error, report) : { status: "done" };
}

export async function saveDiscount(input: DiscountInput): Promise<AdminEditResult> {
  const parsed = discountSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminRevenue);
  const { id, orderId, subscriptionId, amountIqd, reason } = parsed.data;
  const { error } = await supabase.rpc("admin_save_discount", {
    p_id: id ?? undefined,
    p_order_id: orderId ?? undefined,
    p_subscription_id: subscriptionId ?? undefined,
    p_amount_iqd: amountIqd,
    p_reason: reason,
  });
  return error ? editFailure("admin_save_discount", error, report) : { status: "done" };
}

export async function voidDiscount(input: VoidInput): Promise<AdminEditResult> {
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminRevenue);
  const { error } = await supabase.rpc("admin_void_discount", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  return error ? editFailure("admin_void_discount", error, report) : { status: "done" };
}

export async function saveManualSale(
  input: ManualSaleInput,
): Promise<AdminEditResult | { status: "done"; id: string }> {
  // The form sends the phone as typed (07…); the database stores E.164.
  const phone = input.customerPhone.trim();
  const parsed = manualSaleSchema.safeParse({
    ...input,
    customerPhone: phone === "" ? "" : (normalizeIraqiMobile(phone) ?? phone),
  });
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminRevenue);
  const d = parsed.data;
  const { data, error } = await supabase.rpc("admin_save_manual_sale", {
    p_id: d.id ?? undefined,
    p_sold_on: d.soldOn,
    p_customer_name: d.customerName,
    p_customer_phone: d.customerPhone === "" ? undefined : d.customerPhone,
    p_service: d.service,
    p_place: d.place === "" ? undefined : d.place,
    p_amount_iqd: d.amountIqd,
    p_crew_id: d.crewId ?? undefined,
    p_note: d.note === "" ? undefined : d.note,
    p_paid_account_id: d.paidAccountId ?? undefined,
  });
  if (error) return editFailure("admin_save_manual_sale", error, report);
  // A new sale opens again to take more payments; an edit closes.
  return d.id ? { status: "done" } : { status: "done", id: data };
}

export async function voidManualSale(input: VoidInput): Promise<AdminEditResult> {
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminRevenue);
  const { error } = await supabase.rpc("admin_void_manual_sale", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  return error ? editFailure("admin_void_manual_sale", error, report) : { status: "done" };
}

export async function closeFinanceMonth(input: MonthCloseInput): Promise<AdminEditResult> {
  const parsed = monthCloseSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminFinanceReports);
  const { error } = await supabase.rpc("admin_close_finance_month", {
    p_month: `${parsed.data.month}-01`,
  });
  return error ? editFailure("admin_close_finance_month", error, report) : { status: "done" };
}

export async function reopenFinanceMonth(input: MonthReopenInput): Promise<AdminEditResult> {
  const parsed = monthReopenSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminFinanceReports);
  const { error } = await supabase.rpc("admin_reopen_finance_month", {
    p_month: `${parsed.data.month}-01`,
    p_reason: parsed.data.reason,
  });
  return error ? editFailure("admin_reopen_finance_month", error, report) : { status: "done" };
}

// Payroll (A21) ------------------------------------------------------------------------------

export async function saveWorker(
  input: WorkerInput,
): Promise<AdminEditResult | { status: "done"; id: string }> {
  // The form sends the phone as typed (07…); the database stores E.164.
  const phone = input.phone.trim();
  const parsed = workerSchema.safeParse({
    ...input,
    phone: phone === "" ? "" : (normalizeIraqiMobile(phone) ?? phone),
  });
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPayroll);
  const d = parsed.data;
  const { data, error } = await supabase.rpc("admin_save_worker", {
    p_id: d.id ?? undefined,
    p_name: d.name,
    p_phone: d.phone === "" ? undefined : d.phone,
    p_note: d.note === "" ? undefined : d.note,
    p_opening_balance_iqd: d.openingBalanceIqd,
    p_active: d.active,
  });
  if (error) return editFailure("admin_save_worker", error, report);
  return { status: "done", id: data };
}

export async function moveWorker(input: WorkerMoveInput): Promise<AdminEditResult> {
  const parsed = workerMoveSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPayroll);
  const { error } = await supabase.rpc("admin_move_worker", {
    p_worker_id: parsed.data.workerId,
    // A null crew means "leaves crews": the RPC takes the SQL null.
    p_crew_id: parsed.data.crewId as string,
    p_on: parsed.data.on,
  });
  return error ? editFailure("admin_move_worker", error, report) : { status: "done" };
}

export async function deleteWorkerCrew(id: number): Promise<AdminEditResult> {
  const parsed = payrollIdSchema.safeParse(id);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPayroll);
  const { error } = await supabase.rpc("admin_delete_worker_crew", { p_id: parsed.data });
  return error ? editFailure("admin_delete_worker_crew", error, report) : { status: "done" };
}

export async function saveWorkerRate(input: WorkerRateInput): Promise<AdminEditResult> {
  const parsed = workerRateSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPayroll);
  const d = parsed.data;
  const { error } = await supabase.rpc("admin_save_worker_rate", {
    p_worker_id: d.workerId,
    p_effective_on: d.effectiveOn,
    p_pay_type: d.payType,
    p_amount_iqd: d.amountIqd,
  });
  return error ? editFailure("admin_save_worker_rate", error, report) : { status: "done" };
}

export async function voidWorkerRate(input: PayrollVoidInput): Promise<AdminEditResult> {
  const parsed = payrollVoidSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPayroll);
  const { error } = await supabase.rpc("admin_void_worker_rate", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  return error ? editFailure("admin_void_worker_rate", error, report) : { status: "done" };
}

export async function savePayrollAdjustment(
  input: PayrollAdjustmentInput,
): Promise<AdminEditResult> {
  const parsed = payrollAdjustmentSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPayroll);
  const d = parsed.data;
  const { error } = await supabase.rpc("admin_save_payroll_adjustment", {
    p_worker_id: d.workerId,
    p_adjusted_on: d.adjustedOn,
    p_kind: d.kind,
    p_amount_iqd: d.amountIqd,
    p_reason: d.reason,
  });
  return error ? editFailure("admin_save_payroll_adjustment", error, report) : { status: "done" };
}

export async function voidPayrollAdjustment(input: PayrollVoidInput): Promise<AdminEditResult> {
  const parsed = payrollVoidSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPayroll);
  const { error } = await supabase.rpc("admin_void_payroll_adjustment", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  return error ? editFailure("admin_void_payroll_adjustment", error, report) : { status: "done" };
}

export async function setWorkerDays(input: WorkerDaysInput): Promise<AdminEditResult> {
  const parsed = workerDaysSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPayroll);
  const { error } = await supabase.rpc("admin_set_worker_days", {
    p_worker_id: parsed.data.workerId,
    p_month: `${parsed.data.month}-01`,
    p_days: parsed.data.days,
  });
  return error ? editFailure("admin_set_worker_days", error, report) : { status: "done" };
}

// Partners, equipment and the balance sheet (A22) ---------------------------------------------

export async function savePartner(
  input: PartnerInput,
): Promise<AdminEditResult | { status: "done"; id: string }> {
  // The form sends the phone as typed (07…); the database stores E.164.
  const phone = input.phone.trim();
  const parsed = partnerSchema.safeParse({
    ...input,
    phone: phone === "" ? "" : (normalizeIraqiMobile(phone) ?? phone),
  });
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPartners);
  const d = parsed.data;
  const { data, error } = await supabase.rpc("admin_save_partner", {
    p_id: d.id ?? undefined,
    p_name: d.name,
    p_phone: d.phone === "" ? undefined : d.phone,
    p_note: d.note === "" ? undefined : d.note,
    p_opening_capital_iqd: d.openingCapitalIqd,
    p_active: d.active,
  });
  if (error) return editFailure("admin_save_partner", error, report);
  return { status: "done", id: data };
}

export async function setPartnerShares(input: PartnerSharesInput): Promise<AdminEditResult> {
  const parsed = partnerSharesSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPartners);
  const { error } = await supabase.rpc("admin_set_partner_shares", {
    p_month: `${parsed.data.month}-01`,
    p_shares: Object.fromEntries(parsed.data.shares.map((s) => [s.partnerId, s.shareBp])),
  });
  return error ? editFailure("admin_set_partner_shares", error, report) : { status: "done" };
}

export async function savePartnerMovement(input: PartnerMovementInput): Promise<AdminEditResult> {
  const parsed = partnerMovementSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPartners);
  const d = parsed.data;
  const { error } = await supabase.rpc("admin_save_partner_movement", {
    p_id: d.id ?? undefined,
    p_partner_id: d.partnerId,
    p_moved_on: d.movedOn,
    p_kind: d.kind,
    p_account_id: d.accountId,
    p_amount_iqd: d.amountIqd,
    p_note: d.note === "" ? undefined : d.note,
  });
  return error ? editFailure("admin_save_partner_movement", error, report) : { status: "done" };
}

export async function voidPartnerMovement(input: VoidInput): Promise<AdminEditResult> {
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPartners);
  const { error } = await supabase.rpc("admin_void_partner_movement", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  return error ? editFailure("admin_void_partner_movement", error, report) : { status: "done" };
}

export async function saveOpeningEquipment(input: OpeningEquipmentInput): Promise<AdminEditResult> {
  const parsed = openingEquipmentSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPartners);
  const d = parsed.data;
  const { error } = await supabase.rpc("admin_save_opening_equipment", {
    p_id: d.id ?? undefined,
    p_name: d.name,
    p_value_iqd: d.valueIqd,
    p_months_left: d.monthsLeft,
    p_note: d.note === "" ? undefined : d.note,
  });
  return error ? editFailure("admin_save_opening_equipment", error, report) : { status: "done" };
}

export async function voidOpeningEquipment(input: VoidInput): Promise<AdminEditResult> {
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPartners);
  const { error } = await supabase.rpc("admin_void_opening_equipment", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  return error ? editFailure("admin_void_opening_equipment", error, report) : { status: "done" };
}

export async function saveEquipmentDisposal(
  input: EquipmentDisposalInput,
): Promise<AdminEditResult> {
  const parsed = equipmentDisposalSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPartners);
  const d = parsed.data;
  const { error } = await supabase.rpc("admin_save_equipment_disposal", {
    p_expense_id: d.expenseId ?? undefined,
    p_opening_equipment_id: d.openingEquipmentId ?? undefined,
    p_disposed_on: d.disposedOn,
    p_account_id: d.accountId ?? undefined,
    p_proceeds_iqd: d.proceedsIqd,
    p_note: d.note === "" ? undefined : d.note,
  });
  return error ? editFailure("admin_save_equipment_disposal", error, report) : { status: "done" };
}

export async function voidEquipmentDisposal(input: VoidInput): Promise<AdminEditResult> {
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminPartners);
  const { error } = await supabase.rpc("admin_void_equipment_disposal", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  return error ? editFailure("admin_void_equipment_disposal", error, report) : { status: "done" };
}

// Stock (A23) ---------------------------------------------------------------------------------

export async function saveStockItem(
  input: StockItemInput,
): Promise<AdminEditResult | { status: "done"; id: string }> {
  const parsed = stockItemSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminStock);
  const d = parsed.data;
  const { data, error } = await supabase.rpc("admin_save_stock_item", {
    p_id: d.id ?? undefined,
    p_name: d.name,
    p_unit: d.unit,
    p_min_quantity: d.minQuantity,
    p_note: d.note === "" ? undefined : d.note,
    p_active: d.active,
  });
  if (error) return editFailure("admin_save_stock_item", error, report);
  return { status: "done", id: data };
}

export async function deleteStockItem(input: { id: string }): Promise<AdminEditResult> {
  const parsed = voidSchema.shape.id.safeParse(input.id);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminStock);
  const { error } = await supabase.rpc("admin_delete_stock_item", { p_id: parsed.data });
  return error ? editFailure("admin_delete_stock_item", error, report) : { status: "done" };
}

export async function saveStockMove(input: StockMoveInput): Promise<AdminEditResult> {
  const parsed = stockMoveSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminStock);
  const d = parsed.data;
  const { error } = await supabase.rpc("admin_save_stock_move", {
    p_id: d.id ?? undefined,
    p_item_id: d.itemId,
    p_moved_on: d.movedOn,
    p_kind: d.kind,
    p_quantity: d.quantity,
    p_crew_id: d.crewId ?? undefined,
    p_expense_id: d.expenseId ?? undefined,
    p_note: d.note === "" ? undefined : d.note,
  });
  return error ? editFailure("admin_save_stock_move", error, report) : { status: "done" };
}

export async function voidStockMove(input: VoidInput): Promise<AdminEditResult> {
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const supabase = await admin(routes.adminStock);
  const { error } = await supabase.rpc("admin_void_stock_move", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  return error ? editFailure("admin_void_stock_move", error, report) : { status: "done" };
}
