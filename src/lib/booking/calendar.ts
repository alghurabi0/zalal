// The month calendar behind Booking's "تاريخ آخر" (spec §5.9): customers may
// book any future day (settled Oct 30, 2026). Months are "2026-11"; days are
// Baghdad calendar days ("2026-11-05", Postgres `date`). Pure, so the grid is
// unit-tested.

import { z } from "zod";

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** "2026-11-05" → "2026-11" */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** A month moved by whole months: addMonth("2026-12", 1) = "2027-01". */
export function addMonth(month: string, months: number): string {
  const [year, index] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, index - 1 + months, 1));
  return date.toISOString().slice(0, 7);
}

/** The month's first and last day, which booking_availability(from, to) takes. */
export function monthRange(month: string): { from: string; to: string } {
  const [year, index] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/**
 * The month as weeks of seven, Saturday first (the Iraqi week), with null
 * before the 1st and after the last day.
 */
export function monthWeeks(month: string): (string | null)[][] {
  const { from, to } = monthRange(month);
  const first = new Date(`${from}T00:00:00Z`);
  // getUTCDay: 0 = Sunday … 6 = Saturday; Saturday is column 0.
  const lead = (first.getUTCDay() + 1) % 7;
  const count = Number(to.slice(8));
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= count; day++) cells.push(`${month}-${String(day).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
