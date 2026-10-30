import { describe, expect, it } from "vitest";

import { type DayOption, withExtraDay } from "@/lib/booking/availability";
import { addMonth, monthOf, monthRange, monthWeeks } from "@/lib/booking/calendar";
import { formatMonthName } from "@/lib/dates";
import { bookingDaysSchema } from "@/lib/schemas/booking";

// Booking's month calendar ("تاريخ آخر", spec §5.9): any future day.

describe("month helpers", () => {
  it("moves across years", () => {
    expect(monthOf("2026-12-31")).toBe("2026-12");
    expect(addMonth("2026-12", 1)).toBe("2027-01");
    expect(addMonth("2027-01", -1)).toBe("2026-12");
    expect(addMonth("2026-10", 14)).toBe("2027-12");
  });

  it("gives the month's first and last day", () => {
    expect(monthRange("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2027-02")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
  });

  it("lays the month out in weeks starting on Saturday", () => {
    // 1 November 2026 is a Sunday: one empty Saturday before it.
    const weeks = monthWeeks("2026-11");
    expect(weeks[0]).toEqual([
      null,
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    // 1 May 2027 is a Saturday: no empty cell before it.
    expect(monthWeeks("2027-05")[0]?.[0]).toBe("2027-05-01");
  });

  it("names a day's month in Iraqi Arabic", () => {
    expect(formatMonthName("2027-01-05")).toBe("كانون الثاني");
  });
});

describe("withExtraDay", () => {
  const day = (date: string): DayOption => ({ date, slots: [], full: false });

  it("adds a picked day in date order, once", () => {
    const row = [day("2026-11-01"), day("2026-11-02")];
    expect(withExtraDay(row, null)).toBe(row);
    expect(withExtraDay(row, day("2026-11-02"))).toBe(row);
    expect(withExtraDay(row, day("2027-03-10")).map((d) => d.date)).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2027-03-10",
    ]);
  });
});

describe("bookingDaysSchema", () => {
  it("takes up to 62 days, in order", () => {
    expect(bookingDaysSchema.safeParse({ from: "2027-01-01", to: "2027-01-01" }).success).toBe(
      true,
    );
    expect(bookingDaysSchema.safeParse({ from: "2027-01-01", to: "2027-03-03" }).success).toBe(
      true,
    );
    expect(bookingDaysSchema.safeParse({ from: "2027-01-01", to: "2027-03-04" }).success).toBe(
      false,
    );
    expect(bookingDaysSchema.safeParse({ from: "2027-01-02", to: "2027-01-01" }).success).toBe(
      false,
    );
    expect(bookingDaysSchema.safeParse({ from: "2027-1-1", to: "2027-01-01" }).success).toBe(false);
  });
});
