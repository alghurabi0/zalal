// Database errors from the A8, A9, A10, A13 and A14 admin RPCs (codes in
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
  if (error.code === "22023") return error.message === "date_in_past" ? "date_in_past" : "invalid";
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
