import { describe, expect, it } from "vitest";

import {
  FIX_MAX_AGE_MS,
  fixOf,
  locationErrorFor,
  SEND_INTERVAL_MS,
  shouldSend,
} from "@/lib/crew/location";
import {
  ageSeconds,
  distanceKm,
  distanceParts,
  isStale,
  trackingSteps,
} from "@/lib/live/tracking";

const karbalaShrine = { lat: 32.6163, lng: 44.0324 };
const alAbbasShrine = { lat: 32.6159, lng: 44.0353 };

describe("distanceKm", () => {
  it("measures a straight line", () => {
    expect(distanceKm(karbalaShrine, karbalaShrine)).toBe(0);
    // The two shrines are about 275 m apart.
    expect(distanceKm(karbalaShrine, alAbbasShrine)).toBeCloseTo(0.275, 1);
    // One degree of latitude is about 111 km.
    expect(distanceKm({ lat: 32, lng: 44 }, { lat: 33, lng: 44 })).toBeCloseTo(111.2, 0);
  });
});

describe("distanceParts", () => {
  it("shows km with one decimal from 1 km, metres below", () => {
    expect(distanceParts(3.24)).toEqual({ unit: "km", value: "3.2" });
    expect(distanceParts(1)).toEqual({ unit: "km", value: "1.0" });
    expect(distanceParts(0.996)).toEqual({ unit: "km", value: "1.0" });
    expect(distanceParts(0.854)).toEqual({ unit: "m", value: "850" });
    expect(distanceParts(0)).toEqual({ unit: "m", value: "10" });
  });
});

describe("ageSeconds and isStale", () => {
  const saved = "2026-10-26T10:00:00.000Z";
  const at = (iso: string) => new Date(iso).getTime();

  it("counts from the server's clock, whatever the phone's says", () => {
    expect(ageSeconds(saved, at("2026-10-26T10:00:30Z"), 0)).toBe(30);
    // A phone 5 minutes slow: the offset puts it right.
    expect(ageSeconds(saved, at("2026-10-26T09:55:30Z"), 5 * 60 * 1000)).toBe(30);
    // Never negative when the phone runs a little ahead.
    expect(ageSeconds(saved, at("2026-10-26T09:59:58Z"), 0)).toBe(0);
  });

  it("calls a position stale after 2 minutes", () => {
    expect(isStale(120)).toBe(false);
    expect(isStale(121)).toBe(true);
  });
});

describe("trackingSteps", () => {
  const states = (status: Parameters<typeof trackingSteps>[0]) =>
    trackingSteps(status).map((s) => s.state);

  it("follows the order status", () => {
    expect(states("confirmed")).toEqual(["now", "next", "next", "next"]);
    expect(states("on_the_way")).toEqual(["done", "now", "next", "next"]);
    expect(states("arrived")).toEqual(["done", "done", "now", "next"]);
    expect(states("in_progress")).toEqual(["done", "done", "now", "next"]);
    expect(states("completed")).toEqual(["done", "done", "done", "done"]);
    expect(trackingSteps("on_the_way").map((s) => s.step)).toEqual([
      "confirmed",
      "on_the_way",
      "arrived",
      "completed",
    ]);
  });
});

describe("crew GPS: shouldSend", () => {
  const fix = (at: number) => ({ lat: 32.6, lng: 44, accuracyM: 10, at });
  const now = 1_000_000;

  it("sends the first fresh fix at once", () => {
    expect(shouldSend(fix(now - 1000), null, now)).toBe(true);
    expect(shouldSend(null, null, now)).toBe(false);
  });

  it("never sends an old fix, which would look fresh to the customer", () => {
    expect(shouldSend(fix(now - FIX_MAX_AGE_MS - 1), null, now)).toBe(false);
  });

  it("sends a newer fix at most every 15 s", () => {
    const last = { at: now - SEND_INTERVAL_MS + 1, fixAt: now - 20_000 };
    expect(shouldSend(fix(now - 100), last, now)).toBe(false);
    expect(shouldSend(fix(now - 100), { ...last, at: now - SEND_INTERVAL_MS }, now)).toBe(true);
  });

  it("doesn't send the same fix twice", () => {
    const last = { at: now - 30_000, fixAt: now - 31_000 };
    expect(shouldSend(fix(now - 31_000), last, now)).toBe(false);
  });

  it("reads a browser position and caps the accuracy", () => {
    const position = {
      coords: { latitude: 32.6, longitude: 44.02, accuracy: 250_000 },
      timestamp: 42,
    } as GeolocationPosition;
    expect(fixOf(position)).toEqual({ lat: 32.6, lng: 44.02, accuracyM: 100_000, at: 42 });
  });

  it("maps the database's refusals", () => {
    expect(locationErrorFor({ code: "ZL024" })).toBe("location_not_allowed");
    expect(locationErrorFor({ code: "P0002" })).toBe("not_found");
    expect(locationErrorFor({ code: "42501" })).toBe("failed");
    expect(locationErrorFor(null)).toBe("failed");
  });
});
