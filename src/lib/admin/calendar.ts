import { WEEK_ORDER } from "@/lib/schemas/admin-catalog";

// The A9 blocked-dates calendar (spec §8.2). Months are "YYYY-MM" and days
// "YYYY-MM-DD", Baghdad calendar days as Postgres `date` holds them; all
// arithmetic is in UTC so the device's time zone can't shift a day.

/** The days of `month` in weeks that start on Saturday; null pads the edges. */
export function monthWeeks(month: string): (string | null)[][] {
  const first = new Date(`${month}-01T00:00:00Z`);
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() - WEEK_ORDER[0] + 7) % 7;
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** "2026-10" moved by whole months. */
export function addMonthsTo(month: string, months: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 7);
}

/** The first and last day of a month. */
export function monthRange(month: string): { from: string; to: string } {
  const last = new Date(`${addMonthsTo(month, 1)}-01T00:00:00Z`);
  last.setUTCDate(0);
  return { from: `${month}-01`, to: last.toISOString().slice(0, 10) };
}
