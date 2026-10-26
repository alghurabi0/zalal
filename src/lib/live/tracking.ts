import type { OrderStatus } from "@/lib/orders/status";

// What Tracking (spec §5.13) and the admin live map (§8.2 A3) show about a
// crew on the way: the straight-line distance (no routing, §1), how old the
// last position is, and the four steps. The crew phone sends a position at
// most every 15 s (§8.1).

/** "موقع الفريق ما ديتحدث هسه" after this long without a position. */
export const STALE_AFTER_MS = 2 * 60 * 1000;

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance in km (haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "3.2" km from 1 km up, otherwise metres to the nearest 10 ("850"). */
export function distanceParts(km: number): { unit: "km" | "m"; value: string } {
  if (km >= 0.995) return { unit: "km", value: km.toFixed(1) };
  return { unit: "m", value: String(Math.max(10, Math.round((km * 1000) / 10) * 10)) };
}

/**
 * Seconds since the position was saved, by the server's clock: `offsetMs`
 * is the server's time minus the device's when the page loaded, so a phone
 * set to the wrong time still shows the right age.
 */
export function ageSeconds(updatedAt: string, nowMs: number, offsetMs: number): number {
  return Math.max(0, Math.floor((nowMs + offsetMs - new Date(updatedAt).getTime()) / 1000));
}

export function isStale(ageS: number): boolean {
  return ageS * 1000 > STALE_AFTER_MS;
}

export const TRACKING_STEPS = ["confirmed", "on_the_way", "arrived", "completed"] as const;
export type TrackingStep = (typeof TRACKING_STEPS)[number];
export type StepState = "done" | "now" | "next";

/** The four bars on Tracking (تأكد / بالطريق / وصل / خلص), from the order status. */
export function trackingSteps(status: OrderStatus): { step: TrackingStep; state: StepState }[] {
  const reached: Partial<Record<OrderStatus, number>> = {
    confirmed: 0,
    on_the_way: 1,
    arrived: 2,
    in_progress: 2,
    completed: 3,
  };
  const at = reached[status] ?? -1;
  return TRACKING_STEPS.map((step, index) => ({
    step,
    state:
      index < at || (status === "completed" && index === at)
        ? "done"
        : index === at
          ? "now"
          : "next",
  }));
}

/** A point on the drawn map: 0–1 from west to east (x) and north to south (y). */
export type MapPoint = { x: number; y: number };

/**
 * Places the home and the crew on the drawn map (no Google Maps key), to
 * scale and north up, both inside the middle of the box. Alone, the home
 * sits in the middle. `crew` may be missing (no position yet, or arrived).
 */
export function placePins(
  home: LatLng,
  crew: LatLng | null,
): { home: MapPoint; crew: MapPoint | null } {
  if (!crew) return { home: { x: 0.5, y: 0.5 }, crew: null };
  const cos = Math.cos((home.lat * Math.PI) / 180);
  const dx = (crew.lng - home.lng) * cos;
  const dy = crew.lat - home.lat;
  const span = Math.max(Math.abs(dx), Math.abs(dy), 1e-9);
  // Each pin at most 0.32 from the middle, so both stay clear of the edges.
  const sx = (dx / span) * 0.32;
  const sy = (dy / span) * 0.32;
  return {
    home: { x: 0.5 - sx / 2, y: 0.5 + sy / 2 },
    crew: { x: 0.5 + sx / 2, y: 0.5 - sy / 2 },
  };
}
