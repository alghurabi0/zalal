// The crew phone's GPS while a job is on the way (spec §8.1 GPS rule). The
// phone sends its latest fix at most every 15 s; the database skips anything
// closer than 10 s apart (share_crew_location), so a clock or timer hiccup
// can't flood the customer's screen.

/** How often the phone sends its position. */
export const SEND_INTERVAL_MS = 15_000;

/**
 * A fix older than this isn't sent: without signal the phone keeps handing
 * back its last fix, and sending it again would make an old position look
 * fresh on the customer's screen.
 */
export const FIX_MAX_AGE_MS = 60_000;

export type Fix = { lat: number; lng: number; accuracyM: number; at: number };

/**
 * Whether to send `fix` now. Times are the phone's own clock (both sides),
 * so only their difference matters. A fix already sent isn't sent again.
 */
export function shouldSend(
  fix: Fix | null,
  last: { at: number; fixAt: number } | null,
  now: number,
): fix is Fix {
  if (!fix || now - fix.at > FIX_MAX_AGE_MS) return false;
  if (!last) return true;
  return fix.at > last.fixAt && now - last.at >= SEND_INTERVAL_MS;
}

export function fixOf(position: GeolocationPosition): Fix {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracyM: Math.max(0, Math.min(position.coords.accuracy, 100_000)),
    at: position.timestamp,
  };
}

export type LocationError = "location_not_allowed" | "not_found" | "failed";

export function locationErrorFor(error: { code?: string } | null | undefined): LocationError {
  if (error?.code === "ZL024") return "location_not_allowed";
  if (error?.code === "P0002") return "not_found";
  return "failed";
}
