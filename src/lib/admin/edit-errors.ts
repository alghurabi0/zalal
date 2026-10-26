// Database errors from the A8, A9 and A13 admin RPCs (codes in
// supabase/CLAUDE.md), as those screens show them.

export const ADMIN_EDIT_ERRORS = [
  "slot_exists",
  "invalid_area",
  "last_active_area",
  "date_in_past",
  "invalid",
  "not_found",
  "failed",
] as const;

export type AdminEditError = (typeof ADMIN_EDIT_ERRORS)[number];

const byCode: Record<string, AdminEditError> = {
  ZL015: "slot_exists",
  ZL016: "invalid_area",
  ZL017: "last_active_area",
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
  return byCode[error.code] ?? "failed";
}

/** A Server Action's answer to an admin edit. */
export type AdminEditResult = { status: "done" } | { status: "error"; error: AdminEditError };

/**
 * The result for a failed admin RPC. Unexpected failures go to Sentry with
 * the SQLSTATE only: the message can quote the input.
 */
export function editFailure(
  rpc: string,
  error: { code?: string; message?: string },
  report: (message: string) => void,
): AdminEditResult {
  const code = adminEditErrorFor(error);
  if (code === "failed") report(`${rpc} failed (${error.code})`);
  return { status: "error", error: code };
}
