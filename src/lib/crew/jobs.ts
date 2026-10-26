import { addDays } from "@/lib/dates";
import type { OrderStatus } from "@/lib/orders/status";

import { isOpenJob } from "./status";

// My jobs (C2): today and tomorrow in Baghdad, grouped by slot. An open job
// from an earlier day (never finished) comes first, and today's finished
// jobs last. Pure, so it can be tested without a clock.

export type JobCardData = {
  id: string;
  number: number;
  status: OrderStatus;
  service_date: string;
  slot_id: number;
  slot_start_at: string;
  slot_end_at: string;
};

export type SlotGroup<T> = { slotStartAt: string; slotEndAt: string; jobs: T[] };
export type DayGroup<T> = { date: string; slots: SlotGroup<T>[] };

export type JobGroups<T> = {
  /** Open jobs from before today. */
  earlier: T[];
  today: DayGroup<T>;
  tomorrow: DayGroup<T>;
  /** Today's completed and no-show jobs. */
  done: T[];
};

const bySlotThenNumber = (a: JobCardData, b: JobCardData) =>
  Date.parse(a.slot_start_at) - Date.parse(b.slot_start_at) || a.number - b.number;

function bySlot<T extends JobCardData>(jobs: T[]): SlotGroup<T>[] {
  const groups = new Map<string, SlotGroup<T>>();
  for (const job of [...jobs].sort(bySlotThenNumber)) {
    // A slot's place on a day: its times, which orders copy (spec §7).
    const key = `${job.slot_start_at}|${job.slot_end_at}`;
    const group = groups.get(key);
    if (group) group.jobs.push(job);
    else
      groups.set(key, { slotStartAt: job.slot_start_at, slotEndAt: job.slot_end_at, jobs: [job] });
  }
  return [...groups.values()];
}

/** `today` is Baghdad's calendar day ("2026-10-26"), from the server's clock. */
export function groupJobs<T extends JobCardData>(jobs: T[], today: string): JobGroups<T> {
  const tomorrow = addDays(today, 1);
  const open = jobs.filter((job) => isOpenJob(job.status));
  return {
    earlier: open.filter((job) => job.service_date < today).sort(bySlotThenNumber),
    today: { date: today, slots: bySlot(open.filter((job) => job.service_date === today)) },
    tomorrow: {
      date: tomorrow,
      slots: bySlot(open.filter((job) => job.service_date === tomorrow)),
    },
    done: jobs
      .filter((job) => !isOpenJob(job.status) && job.service_date === today)
      .sort(bySlotThenNumber),
  };
}

export function isEmpty(groups: JobGroups<unknown>): boolean {
  return (
    groups.earlier.length === 0 &&
    groups.today.slots.length === 0 &&
    groups.tomorrow.slots.length === 0 &&
    groups.done.length === 0
  );
}

/** Google Maps directions to the pin, opened in the Maps app on phones. */
export function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
