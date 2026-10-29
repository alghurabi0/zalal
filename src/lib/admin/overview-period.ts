import { z } from "zod";

import { addMonthsTo, monthRange } from "./calendar";

// A1's order counts cover a period kept in the URL (`/admin?period=`):
// "upcoming" (the default: every order from today on), "today", or a month
// "YYYY-MM". The month under way counts from today to its last day; any
// other month counts whole (settled Oct 29, 2026). Days are Baghdad
// calendar days, as orders.service_date holds them.

export type OverviewPeriod =
  { kind: "upcoming" } | { kind: "today" } | { kind: "month"; month: string };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseOverviewPeriod(raw: string | string[] | undefined): OverviewPeriod {
  const value = z
    .string()
    .optional()
    .catch(undefined)
    .parse(Array.isArray(raw) ? raw[0] : raw);
  if (value === "today") return { kind: "today" };
  if (value && MONTH.test(value)) return { kind: "month", month: value };
  return { kind: "upcoming" };
}

/** The service days a period covers; `to` is null for "from today on". */
export function periodRange(
  period: OverviewPeriod,
  today: string,
): { from: string; to: string | null } {
  switch (period.kind) {
    case "upcoming":
      return { from: today, to: null };
    case "today":
      return { from: today, to: today };
    case "month": {
      const range = monthRange(period.month);
      return period.month === today.slice(0, 7) ? { from: today, to: range.to } : range;
    }
  }
}

/** The month the picker shows: the chosen one, else the month under way. */
export function pickerMonth(period: OverviewPeriod, today: string): string {
  return period.kind === "month" ? period.month : today.slice(0, 7);
}

export function overviewHref(period: OverviewPeriod, base = "/admin"): string {
  if (period.kind === "upcoming") return base;
  return `${base}?period=${period.kind === "today" ? "today" : period.month}`;
}

export function shiftMonth(month: string, months: number): OverviewPeriod {
  return { kind: "month", month: addMonthsTo(month, months) };
}
