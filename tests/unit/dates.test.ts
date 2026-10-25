import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  baghdadHour,
  baghdadToday,
  formatDate,
  formatMonthYear,
} from "@/lib/dates";

describe("dates (Asia/Baghdad)", () => {
  it("formats in Baghdad time with Iraqi month names and Western digits", () => {
    // 22:30 UTC is already the next day in Baghdad (UTC+3).
    expect(formatDate("2026-10-24T22:30:00Z")).toBe("25 تشرين الأول 2026");
    expect(formatMonthYear("2027-04-01T00:00:00Z")).toBe("نيسان 2027");
  });

  it("reads the hour in Baghdad", () => {
    expect(baghdadHour(new Date("2026-10-24T05:00:00Z"))).toBe(8);
    expect(baghdadHour(new Date("2026-10-24T22:00:00Z"))).toBe(1);
  });

  it("adds calendar months on Baghdad's calendar", () => {
    expect(addMonths("2026-03-15T09:00:00Z", 6).toISOString()).toBe("2026-09-15T09:00:00.000Z");
    // 31 Aug + 6 months clamps to the end of February.
    expect(addMonths("2026-08-31T09:00:00Z", 6).toISOString()).toBe("2027-02-28T09:00:00.000Z");
    // 23:00 UTC on 31 Jan is 1 Feb in Baghdad: one month later is 1 Mar there.
    expect(addMonths("2027-01-31T23:00:00Z", 1).toISOString()).toBe("2027-02-28T23:00:00.000Z");
  });
});

describe("baghdadToday and addDays", () => {
  it("takes the day in Baghdad, not UTC", () => {
    // 22:30 UTC is 01:30 the next day in Baghdad.
    expect(baghdadToday(new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    expect(baghdadToday(new Date("2026-10-24T20:59:00Z"))).toBe("2026-10-24");
  });

  it("moves across months and years", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-10-25", 0)).toBe("2026-10-25");
  });
});
