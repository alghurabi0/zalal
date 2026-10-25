import type { DayOption } from "@/lib/booking/availability";

// admin_slot_board() rows, shaped for the A2 board and the admin reschedule
// picker. The database decides what is bookable; these only arrange it.

export type BoardRow = {
  service_date: string;
  slot_id: number;
  start_at: string;
  end_at: string;
  capacity: number;
  taken: number;
  blocked: boolean;
  bookable: boolean;
};

/**
 * Days for DaySlotPicker when an admin reschedules: every slot that hasn't
 * started on a day that isn't blocked, with its places left. Admins aren't
 * held to the customer window or cutoff (spec §6).
 */
export function adminRescheduleDays(rows: BoardRow[], now: Date): DayOption[] {
  const days = new Map<string, DayOption["slots"]>();
  for (const row of rows) {
    if (row.blocked || new Date(row.start_at).getTime() <= now.getTime()) continue;
    const slots = days.get(row.service_date) ?? [];
    slots.push({
      slotId: row.slot_id,
      startAt: row.start_at,
      endAt: row.end_at,
      remaining: Math.max(row.capacity - row.taken, 0),
      bookable: row.bookable,
    });
    days.set(row.service_date, slots);
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, slots]) => ({
      date,
      slots: slots.sort((a, b) => a.startAt.localeCompare(b.startAt)),
      full: !slots.some((slot) => slot.bookable),
    }));
}

export type BoardGrid = {
  days: { date: string; blocked: boolean }[];
  /** One row per slot, by time of day. */
  slots: { slotId: number; startAt: string; endAt: string }[];
  cell: (date: string, slotId: number) => BoardRow | undefined;
};

/** The board as days × slots. A slot's label comes from its earliest row. */
export function boardGrid(rows: BoardRow[], dates: string[]): BoardGrid {
  const cells = new Map(rows.map((row) => [`${row.service_date}|${row.slot_id}`, row]));
  const blocked = new Set(rows.filter((row) => row.blocked).map((row) => row.service_date));
  const slots = new Map<number, { slotId: number; startAt: string; endAt: string }>();
  for (const row of rows) {
    if (!slots.has(row.slot_id)) {
      slots.set(row.slot_id, { slotId: row.slot_id, startAt: row.start_at, endAt: row.end_at });
    }
  }
  // Order rows by the time of day, not the date.
  const timeOfDay = (iso: string) => (new Date(iso).getTime() + 3 * 60 * 60 * 1000) % 86_400_000;
  return {
    days: dates.map((date) => ({ date, blocked: blocked.has(date) })),
    slots: [...slots.values()].sort(
      (a, b) => timeOfDay(a.startAt) - timeOfDay(b.startAt) || a.slotId - b.slotId,
    ),
    cell: (date, slotId) => cells.get(`${date}|${slotId}`),
  };
}
