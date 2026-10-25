import { timeZone } from "@/i18n/config";

// Dates are stored as timestamptz and shown in Baghdad time (CLAUDE.md).
// Business rules never use the device's time zone: everything here takes an
// explicit instant and formats it in Asia/Baghdad. Formats use the Gregorian
// calendar with Western digits, as in the designs.

const LOCALE = "ar-IQ-u-ca-gregory-nu-latn";

const dayMonthYear = new Intl.DateTimeFormat(LOCALE, {
  timeZone,
  day: "numeric",
  month: "long",
  year: "numeric",
});

const monthYear = new Intl.DateTimeFormat(LOCALE, { timeZone, month: "long", year: "numeric" });

const hourInBaghdad = new Intl.DateTimeFormat("en-GB", {
  timeZone,
  hour: "numeric",
  hourCycle: "h23",
});

/** "24 تشرين الأول 2026" */
export function formatDate(value: Date | string): string {
  return dayMonthYear.format(new Date(value));
}

/** "تشرين الأول 2026" */
export function formatMonthYear(value: Date | string): string {
  return monthYear.format(new Date(value));
}

/** The hour (0–23) in Baghdad, for the Home greeting. */
export function baghdadHour(now: Date = new Date()): number {
  return Number(hourInBaghdad.format(now));
}

/**
 * Adds whole calendar months, clamping the day to the target month's length
 * (31 Aug + 6 months = 28/29 Feb). Baghdad has no daylight saving time
 * (UTC+3 all year), so shifting by Baghdad's calendar keeps the time of day.
 */
export function addMonths(value: Date | string, months: number): Date {
  const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;
  const local = new Date(new Date(value).getTime() + BAGHDAD_OFFSET_MS);
  const day = local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0),
  ).getUTCDate();
  local.setUTCDate(Math.min(day, lastDay));
  return new Date(local.getTime() - BAGHDAD_OFFSET_MS);
}

const weekdayOfDate = new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC", weekday: "long" });

const timeInBaghdad = new Intl.DateTimeFormat("en-GB", {
  timeZone,
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/**
 * A service date ("2026-10-24", a calendar day in Baghdad, as Postgres
 * `date`) as Booking's day chip shows it: the weekday name and the day of the
 * month. Read as UTC so the device's time zone can't move it a day.
 */
export function serviceDayParts(serviceDate: string): { weekday: string; day: number } {
  const date = new Date(`${serviceDate}T00:00:00Z`);
  return { weekday: weekdayOfDate.format(date), day: date.getUTCDate() };
}

export type DayPeriod = "morning" | "noon" | "afternoon" | "evening";

/**
 * A slot as the designs write it ("8–10 الصبح"): both ends on a 12-hour
 * clock in Baghdad ("8", "10", or "8:30" when it isn't on the hour), and the
 * part of the day its start falls in. The period's words are in ar.json.
 */
export function slotParts(
  startAt: Date | string,
  endAt: Date | string,
): { from: string; to: string; period: DayPeriod } {
  const clock = (value: Date | string) => {
    const parts = timeInBaghdad.formatToParts(new Date(value));
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return { hour, text: minute === "00" ? String(hour12) : `${hour12}:${minute}` };
  };
  const start = clock(startAt);
  const period: DayPeriod =
    start.hour < 10
      ? "morning"
      : start.hour < 13
        ? "noon"
        : start.hour < 17
          ? "afternoon"
          : "evening";
  return { from: start.text, to: clock(endAt).text, period };
}

const dayMonthTime = new Intl.DateTimeFormat(LOCALE, {
  timeZone,
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "26 تشرين الأول في 9:15 ص", for Order details' timeline. */
export function formatDayTime(value: Date | string): string {
  return dayMonthTime.format(new Date(value));
}
