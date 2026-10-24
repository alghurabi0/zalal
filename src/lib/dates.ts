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
