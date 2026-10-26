// create_order()'s error codes (supabase/CLAUDE.md) as the booking screens
// handle them.

export type BookingError =
  /** ZL005: the last place went to someone else ("الموعد انحجز، اختار موعد ثاني"). */
  | "slot_full"
  /** ZL004: the slot closed, passed the cutoff or the day was blocked. */
  | "slot_unavailable"
  /** ZL001: the address is no longer inside the service area. */
  | "outside_area"
  /** ZL007: more tanks than max_tanks_per_order. */
  | "too_many_tanks"
  /** ZL008 or ZL009: an upload is missing, too old to book (48 h), someone else's or already used. */
  | "upload_missing"
  /** ZL018: an admin changed a price after Checkout showed the total. */
  | "price_changed"
  /** P0002: the address or a saved tank was deleted meanwhile. */
  | "stale"
  | "failed";

const byCode: Record<string, BookingError> = {
  ZL001: "outside_area",
  ZL004: "slot_unavailable",
  ZL005: "slot_full",
  ZL007: "too_many_tanks",
  ZL008: "upload_missing",
  ZL009: "upload_missing",
  ZL018: "price_changed",
  P0002: "stale",
};

export function bookingErrorFor(code: string | undefined): BookingError {
  return (code && byCode[code]) || "failed";
}

/** The step a customer goes back to, to fix the problem. */
export function stepFor(error: BookingError): "details" | "photos" | null {
  if (
    error === "slot_full" ||
    error === "slot_unavailable" ||
    error === "too_many_tanks" ||
    error === "stale"
  ) {
    return "details";
  }
  if (error === "upload_missing") return "photos";
  return null;
}
