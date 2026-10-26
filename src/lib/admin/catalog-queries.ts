import "server-only";

import type { PriceTable } from "@/lib/booking/draft";
import type { Database } from "@/lib/database.types";
import { baghdadToday } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

import { areaFromDatabase, type MultiPolygonCoords } from "./geojson";

// Reads for A8 Prices, A9 Schedule and A13 Settings (spec §8.2), made as the
// admin: RLS lets admins read every price, slot, blocked date, booking,
// setting and service area. Pages call requireViewer(…, "admin") first.

export async function adminPrices(): Promise<PriceTable> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("price_list").select("tank_type, size, price_iqd");
  if (error) throw new Error(`Prices read failed: ${error.message}`);
  const table: PriceTable = { roof: { s: 0, m: 0, l: 0 }, ground: { s: 0, m: 0, l: 0 } };
  for (const row of data) table[row.tank_type][row.size] = row.price_iqd;
  return table;
}

export type AdminSlot = {
  id: number;
  /** "08:00:00", Baghdad time. */
  startTime: string;
  endTime: string;
  capacity: number;
  weekdays: number[];
  active: boolean;
  /** Places held from today on. */
  upcoming: number;
};

/** Every slot, switched-off ones too, by time of day. */
export async function adminSlots(now: Date = new Date()): Promise<AdminSlot[]> {
  const supabase = await createClient();
  const [slots, held] = await Promise.all([
    supabase
      .from("slots")
      .select("id, start_time, end_time, capacity, weekdays, active")
      .order("start_time")
      .order("end_time"),
    supabase.from("slot_bookings").select("slot_id").gte("service_date", baghdadToday(now)),
  ]);
  if (slots.error) throw new Error(`Slots read failed: ${slots.error.message}`);
  if (held.error) throw new Error(`Bookings read failed: ${held.error.message}`);
  const upcoming = new Map<number, number>();
  for (const { slot_id } of held.data) upcoming.set(slot_id, (upcoming.get(slot_id) ?? 0) + 1);
  return slots.data.map((s) => ({
    id: s.id,
    startTime: s.start_time,
    endTime: s.end_time,
    capacity: s.capacity,
    weekdays: s.weekdays,
    active: s.active,
    upcoming: upcoming.get(s.id) ?? 0,
  }));
}

export type ScheduleConflict =
  Database["public"]["Functions"]["admin_schedule_conflicts"]["Returns"][number];

/** Booked orders that no longer fit the schedule (admin_schedule_conflicts). */
export async function scheduleConflicts(): Promise<ScheduleConflict[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_schedule_conflicts");
  if (error) throw new Error(`Schedule conflicts read failed: ${error.message}`);
  return data;
}

export type CalendarDay = { blocked: boolean; reason: string | null; booked: number };

/** Blocked days and places held per day, from `from` to `to` (inclusive). */
export async function scheduleCalendar(
  from: string,
  to: string,
): Promise<Record<string, CalendarDay>> {
  const supabase = await createClient();
  const [blocked, held] = await Promise.all([
    supabase.from("blocked_dates").select("date, reason").gte("date", from).lte("date", to),
    supabase
      .from("slot_bookings")
      .select("service_date")
      .gte("service_date", from)
      .lte("service_date", to),
  ]);
  if (blocked.error) throw new Error(`Blocked dates read failed: ${blocked.error.message}`);
  if (held.error) throw new Error(`Bookings read failed: ${held.error.message}`);
  const days: Record<string, CalendarDay> = {};
  const day = (date: string) => (days[date] ??= { blocked: false, reason: null, booked: 0 });
  for (const row of blocked.data)
    Object.assign(day(row.date), { blocked: true, reason: row.reason });
  for (const row of held.data) day(row.service_date).booked += 1;
  return days;
}

export type AdminSettings = Database["public"]["Tables"]["settings"]["Row"];

export async function adminSettings(): Promise<AdminSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("*").single();
  if (error) throw new Error(`Settings read failed: ${error.message}`);
  return data;
}

export type AdminServiceArea = {
  id: number;
  name: string;
  active: boolean;
  area: MultiPolygonCoords;
};

export async function adminServiceAreas(): Promise<{
  areas: AdminServiceArea[];
  addressesOutside: number;
}> {
  const supabase = await createClient();
  const [areas, outside] = await Promise.all([
    supabase.rpc("admin_service_areas"),
    supabase.rpc("admin_addresses_outside_area"),
  ]);
  if (areas.error) throw new Error(`Service areas read failed: ${areas.error.message}`);
  if (outside.error) throw new Error(`Address count failed: ${outside.error.message}`);
  return {
    areas: areas.data.map((a) => ({
      id: a.id,
      name: a.name,
      active: a.active,
      area: areaFromDatabase(a.area),
    })),
    addressesOutside: outside.data,
  };
}
