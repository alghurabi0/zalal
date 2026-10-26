// Database errors from the admin order RPCs (transition_order, assign_crew;
// codes in supabase/CLAUDE.md), as the A2 drawer shows them. ZL011 carries
// the missing requirement in its message.

export const ADMIN_ORDER_ERRORS = [
  "slot_unavailable",
  "slot_full",
  "invalid_transition",
  "reason_required",
  "crew_not_assigned",
  "before_photo_required",
  "after_photo_required",
  "cash_not_collected",
  "crew_inactive",
  "crew_change_not_allowed",
  "not_found",
  "failed",
] as const;

export type AdminOrderError = (typeof ADMIN_ORDER_ERRORS)[number];

const byCode: Record<string, AdminOrderError> = {
  ZL004: "slot_unavailable",
  ZL005: "slot_full",
  ZL010: "invalid_transition",
  ZL013: "crew_inactive",
  ZL014: "crew_change_not_allowed",
  P0002: "not_found",
};

const requirements = new Set<string>([
  "reason_required",
  "crew_not_assigned",
  "before_photo_required",
  "after_photo_required",
  "cash_not_collected",
]);

export function adminOrderErrorFor(
  error: { code?: string; message?: string } | null | undefined,
): AdminOrderError {
  if (!error?.code) return "failed";
  if (error.code === "ZL011") {
    return error.message && requirements.has(error.message)
      ? (error.message as AdminOrderError)
      : "failed";
  }
  return byCode[error.code] ?? "failed";
}
