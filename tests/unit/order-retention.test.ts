import { describe, expect, it } from "vitest";

import { videosExpired } from "@/lib/orders/retention";

const day = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-28T12:00:00Z");
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * day).toISOString();

describe("videosExpired", () => {
  it("is true a day after the 90 days, once the nightly purge has run", () => {
    const events = [
      { to_status: "pending_confirmation" as const, created_at: at(120) },
      { to_status: "completed" as const, created_at: at(92) },
    ];
    expect(videosExpired("completed", events, now)).toBe(true);
    expect(
      videosExpired("completed", [{ to_status: "completed", created_at: at(90.5) }], now),
    ).toBe(false);
  });

  it("counts cancelled and no-show orders too, from their own event", () => {
    expect(videosExpired("cancelled", [{ to_status: "cancelled", created_at: at(100) }], now)).toBe(
      true,
    );
    expect(videosExpired("no_show", [{ to_status: "no_show", created_at: at(100) }], now)).toBe(
      true,
    );
  });

  it("counts from the newest event into the current status", () => {
    const events = [
      { to_status: "completed" as const, created_at: at(200) },
      { to_status: "in_progress" as const, created_at: at(20) },
      { to_status: "completed" as const, created_at: at(10) },
    ];
    expect(videosExpired("completed", events, now)).toBe(false);
  });

  it("is false for an open order, or one without its closing event", () => {
    expect(videosExpired("confirmed", [{ to_status: "confirmed", created_at: at(300) }], now)).toBe(
      false,
    );
    expect(videosExpired("completed", [], now)).toBe(false);
  });
});
