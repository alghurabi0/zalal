import { addMonths } from "@/lib/dates";

// Home's tank status card (spec §5.5): for the chosen address, the tank due
// soonest. A tank is due `intervalMonths` (the cleaning_interval_months
// setting) after its last cleaning, which only order completion sets.

export type TankHealth = "no_history" | "ok" | "due_soon" | "overdue";

export type TankStatus =
  | { health: "no_history" }
  | {
      health: Exclude<TankHealth, "no_history">;
      lastCleanedAt: string;
      nextDueAt: Date;
      /** Whole months since the last cleaning (Baghdad calendar). */
      monthsSince: number;
      /** 0–1: months since the last cleaning ÷ the interval. */
      fill: number;
    };

const DUE_SOON_MS = 30 * 24 * 60 * 60 * 1000;

function wholeMonthsBetween(from: string, now: Date): number {
  let months = 0;
  while (addMonths(from, months + 1).getTime() <= now.getTime()) months++;
  return months;
}

/**
 * Tanks never cleaned by us have no date to go by, so the card follows the
 * cleaned tank due soonest; with none, it shows "no history".
 */
export function tankStatus(
  tanks: { last_cleaned_at: string | null }[],
  now: Date,
  intervalMonths: number,
): TankStatus {
  let soonest: { lastCleanedAt: string; nextDueAt: Date } | null = null;
  for (const tank of tanks) {
    if (!tank.last_cleaned_at) continue;
    const nextDueAt = addMonths(tank.last_cleaned_at, intervalMonths);
    if (!soonest || nextDueAt < soonest.nextDueAt) {
      soonest = { lastCleanedAt: tank.last_cleaned_at, nextDueAt };
    }
  }
  if (!soonest) return { health: "no_history" };

  const start = new Date(soonest.lastCleanedAt).getTime();
  const due = soonest.nextDueAt.getTime();
  const health =
    now.getTime() > due ? "overdue" : due - now.getTime() <= DUE_SOON_MS ? "due_soon" : "ok";
  const fill = Math.min(1, Math.max(0, (now.getTime() - start) / (due - start)));
  return {
    health,
    ...soonest,
    monthsSince: wholeMonthsBetween(soonest.lastCleanedAt, now),
    fill,
  };
}
