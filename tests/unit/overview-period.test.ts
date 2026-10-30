import { describe, expect, it } from "vitest";

import {
  overviewHref,
  parseOverviewPeriod,
  periodRange,
  pickerMonth,
  shiftMonth,
} from "@/lib/admin/overview-period";

// A1's period (spec §8.2): from today on by default, today, or a month; the
// month under way counts from today to its end.

const today = "2026-10-29";

describe("overview period", () => {
  it("reads the URL, falling back to from today on", () => {
    expect(parseOverviewPeriod(undefined)).toEqual({ kind: "upcoming" });
    expect(parseOverviewPeriod("today")).toEqual({ kind: "today" });
    expect(parseOverviewPeriod("2026-11")).toEqual({ kind: "month", month: "2026-11" });
    expect(parseOverviewPeriod(["2026-09", "today"])).toEqual({ kind: "month", month: "2026-09" });
    expect(parseOverviewPeriod("2026-13")).toEqual({ kind: "upcoming" });
    expect(parseOverviewPeriod("upcoming")).toEqual({ kind: "upcoming" });
  });

  it("covers the right service days", () => {
    expect(periodRange({ kind: "upcoming" }, today)).toEqual({ from: today, to: null });
    expect(periodRange({ kind: "today" }, today)).toEqual({ from: today, to: today });
    // The month under way: today to its last day.
    expect(periodRange({ kind: "month", month: "2026-10" }, today)).toEqual({
      from: today,
      to: "2026-10-31",
    });
    // Other months whole, past and future.
    expect(periodRange({ kind: "month", month: "2026-09" }, today)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(periodRange({ kind: "month", month: "2027-02" }, today)).toEqual({
      from: "2027-02-01",
      to: "2027-02-28",
    });
  });

  it("builds links and moves the month picker", () => {
    expect(overviewHref({ kind: "upcoming" })).toBe("/admin");
    expect(overviewHref({ kind: "today" })).toBe("/admin?period=today");
    expect(overviewHref(shiftMonth("2026-12", 1))).toBe("/admin?period=2027-01");
    expect(overviewHref(shiftMonth("2026-01", -1))).toBe("/admin?period=2025-12");
    expect(pickerMonth({ kind: "upcoming" }, today)).toBe("2026-10");
    expect(pickerMonth({ kind: "month", month: "2027-03" }, today)).toBe("2027-03");
  });
});
