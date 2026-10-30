// Booking step 1's dates and slots (spec §5.9), from booking_availability().
// The function already leaves out closed weekdays and blocked dates.

export type AvailabilityRow = {
  service_date: string;
  slot_id: number;
  start_at: string;
  end_at: string;
  remaining: number;
  bookable: boolean;
};

export type SlotOption = {
  slotId: number;
  startAt: string;
  endAt: string;
  remaining: number;
  bookable: boolean;
};

export type DayOption = {
  /** "2026-10-24", a Baghdad calendar day. */
  date: string;
  slots: SlotOption[];
  /** Every slot that day is taken ("ممتلئ"). */
  full: boolean;
};

/**
 * Groups the rows by day. A slot starting within the cutoff can't be booked
 * any more, so it is left out rather than shown as full, and a day left with
 * no slots (today, late in the day) is left out too. The database decides
 * again when the booking is made.
 */
export function bookingDays(rows: AvailabilityRow[], now: Date, cutoffHours: number): DayOption[] {
  const earliest = now.getTime() + cutoffHours * 60 * 60 * 1000;
  const days = new Map<string, SlotOption[]>();
  for (const row of rows) {
    if (new Date(row.start_at).getTime() < earliest) continue;
    const slots = days.get(row.service_date) ?? [];
    slots.push({
      slotId: row.slot_id,
      startAt: row.start_at,
      endAt: row.end_at,
      remaining: row.remaining,
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

export function findSlot(
  days: DayOption[],
  date: string | null,
  slotId: number | null,
): SlotOption | null {
  return days.find((d) => d.date === date)?.slots.find((s) => s.slotId === slotId) ?? null;
}

/**
 * The days with `extra` (a day picked in the month calendar) added in date
 * order, unless they already hold that day.
 */
export function withExtraDay(days: DayOption[], extra: DayOption | null): DayOption[] {
  if (!extra || days.some((day) => day.date === extra.date)) return days;
  return [...days, extra].sort((a, b) => a.date.localeCompare(b.date));
}
