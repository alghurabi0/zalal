import { subscriptionReasonFor } from "@/lib/subscriptions/errors";

// Database errors from the A7, A8, A9, A10, A11, A13, A14 and A15–A23 admin RPCs (codes in
// supabase/CLAUDE.md), as those screens show them.

export const ADMIN_EDIT_ERRORS = [
  "slot_exists",
  "invalid_area",
  "last_active_area",
  "date_in_past",
  "phone_has_account",
  "crew_name_taken",
  "account_is_crew",
  "cannot_remove_self",
  "account_deleted",
  "upload_not_found",
  "category_in_use",
  "slug_taken",
  "slug_locked",
  "category_name_taken",
  "subscription_exists",
  "invalid_subscription_status",
  "subscription_change_not_allowed",
  "no_subscription",
  "outside_subscription_period",
  "no_visits_left",
  "subscription_tanks_exceeded",
  "reason_required",
  "invalid_start",
  "invalid_adjustment",
  "before_finance_start",
  "date_in_future",
  "account_inactive",
  "category_inactive",
  "expense_category_in_use",
  "records_before_start",
  "record_voided",
  "name_taken",
  "same_account",
  "payment_not_allowed",
  "refund_too_large",
  "discount_not_allowed",
  "discount_exists",
  "paid_set_by_finance",
  "month_closed",
  "close_not_allowed",
  "reopen_not_allowed",
  "books_closed",
  "worker_inactive",
  "worker_not_allowed",
  "membership_overlap",
  "rate_exists",
  "same_crew",
  "partner_inactive",
  "life_not_allowed",
  "shares_total",
  "equipment_disposed",
  "partner_has_share",
  "item_inactive",
  "item_in_use",
  "crew_inactive",
  "expense_has_stock",
  "stock_too_low",
  "count_exists",
  "expense_not_allowed",
  "invalid",
  "not_found",
  "failed",
] as const;

export type AdminEditError = (typeof ADMIN_EDIT_ERRORS)[number];

const byCode: Record<string, AdminEditError> = {
  ZL015: "slot_exists",
  ZL016: "invalid_area",
  ZL017: "last_active_area",
  ZL019: "phone_has_account",
  ZL020: "crew_name_taken",
  ZL021: "account_is_crew",
  ZL022: "cannot_remove_self",
  ZL009: "upload_not_found",
  ZL030: "category_in_use",
  ZL031: "slug_taken",
  ZL032: "slug_locked",
  ZL033: "category_name_taken",
  ZL035: "subscription_exists",
  ZL036: "invalid_subscription_status",
  ZL038: "subscription_change_not_allowed",
  ZL042: "before_finance_start",
  ZL043: "date_in_future",
  ZL045: "expense_category_in_use",
  ZL046: "records_before_start",
  ZL047: "record_voided",
  ZL048: "name_taken",
  ZL049: "payment_not_allowed",
  ZL050: "refund_too_large",
  ZL051: "discount_not_allowed",
  ZL052: "discount_exists",
  ZL053: "paid_set_by_finance",
  ZL054: "month_closed",
  ZL056: "books_closed",
  ZL057: "worker_not_allowed",
  ZL058: "membership_overlap",
  ZL059: "rate_exists",
  ZL060: "life_not_allowed",
  ZL061: "shares_total",
  ZL062: "equipment_disposed",
  ZL063: "partner_has_share",
  ZL013: "crew_inactive",
  ZL064: "expense_has_stock",
  ZL065: "stock_too_low",
  ZL066: "count_exists",
  ZL067: "expense_not_allowed",
  P0002: "not_found",
  // A value the table's checks refuse: the form's Zod schema should have
  // caught it, but the database has the last word.
  "23514": "invalid",
  "23502": "invalid",
  "22P02": "invalid",
  "22007": "invalid",
  "22008": "invalid",
  "22003": "invalid",
};

export function adminEditErrorFor(
  error: { code?: string; message?: string } | null | undefined,
): AdminEditError {
  if (!error?.code) return "failed";
  if (error.code === "22023") {
    if (error.message === "date_in_past") return "date_in_past";
    if (error.message === "invalid_start") return "invalid_start";
    if (error.message === "invalid_adjustment") return "invalid_adjustment";
    if (error.message === "same_account") return "same_account";
    if (error.message === "same_crew") return "same_crew";
    return "invalid";
  }
  // ZL034 and ZL011 carry the reason in the message (A7, A2).
  if (error.code === "ZL034") return subscriptionReasonFor(error.message);
  if (error.code === "ZL011" && error.message === "reason_required") return "reason_required";
  // A switched-off box, category (A15, A16) or worker (A21).
  if (error.code === "ZL044") {
    if (error.message === "worker_inactive") return "worker_inactive";
    if (error.message === "partner_inactive") return "partner_inactive";
    if (error.message === "item_inactive") return "item_inactive";
    return error.message === "category_inactive" ? "category_inactive" : "account_inactive";
  }
  // A stock item (A23) or an expense category (A17) still in use.
  if (error.code === "ZL045") {
    return error.message === "item_in_use" ? "item_in_use" : "expense_category_in_use";
  }
  // A20's month close: which way it was refused.
  if (error.code === "ZL055") {
    return error.message === "reopen_not_allowed" ? "reopen_not_allowed" : "close_not_allowed";
  }
  // A phone whose account was deleted (A10, A14): Auth still holds it.
  if (error.code === "P0002" && error.message === "account_not_found") return "account_deleted";
  return byCode[error.code] ?? "failed";
}

/** A Server Action's answer to an admin edit. */
export type AdminEditFailure = { status: "error"; error: AdminEditError };
export type AdminEditResult = { status: "done" } | AdminEditFailure;

/**
 * The result for a failed admin RPC. Unexpected failures go to Sentry with
 * the SQLSTATE only: the message can quote the input.
 */
export function editFailure(
  rpc: string,
  error: { code?: string; message?: string },
  report: (message: string) => void,
): AdminEditFailure {
  const code = adminEditErrorFor(error);
  if (code === "failed") report(`${rpc} failed (${error.code})`);
  return { status: "error", error: code };
}
