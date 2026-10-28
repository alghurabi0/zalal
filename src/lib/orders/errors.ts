// transition_order()'s error codes (supabase/CLAUDE.md) as the cancel (N6)
// and reschedule (N7) sheets handle them.

export type OrderChangeError =
  /** ZL006: inside the cutoff ("راسلنا بالمحادثة"). */
  | "too_late"
  /** ZL005: the new slot's last place went to someone else. */
  | "slot_full"
  /** ZL004: the new slot closed, passed the cutoff or the day was blocked. */
  | "slot_unavailable"
  /** ZL010: the order moved on meanwhile (confirmed → on the way, cancelled…). */
  | "invalid_transition"
  /** ZL034: a covered order can't move outside its subscription's period (Phase 6). */
  | "outside_subscription"
  | "failed";

const byCode: Record<string, OrderChangeError> = {
  ZL004: "slot_unavailable",
  ZL005: "slot_full",
  ZL006: "too_late",
  ZL010: "invalid_transition",
  ZL034: "outside_subscription",
};

export function orderChangeErrorFor(code: string | undefined): OrderChangeError {
  return (code && byCode[code]) || "failed";
}
