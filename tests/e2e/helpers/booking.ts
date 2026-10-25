import { randomUUID } from "node:crypto";

import { e164 } from "./auth";
import { admin } from "./supabase";

// Booking test data. Each test makes its own slot at a time no other test
// uses, so tests running in parallel (and earlier runs on the same local
// database) never take each other's places.

const periods = { morning: "الصبح", noon: "الظهر", afternoon: "العصر", evening: "المسا" };

export type TestSlot = { id: number; label: string; startTime: string; endTime: string };

/** A slot on every weekday at a random hh:mm (06:01–19:59), two hours long. */
export async function createSlot(capacity = 20): Promise<TestSlot> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const hour = 6 + Math.floor(Math.random() * 14);
    const minute = 1 + Math.floor(Math.random() * 59);
    const pad = (n: number) => String(n).padStart(2, "0");
    const startTime = `${pad(hour)}:${pad(minute)}`;
    const endTime = `${pad(hour + 2)}:${pad(minute)}`;
    const { data, error } = await admin
      .from("slots")
      .insert({
        start_time: startTime,
        end_time: endTime,
        capacity,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      })
      .select("id")
      .single();
    if (error?.code === "23505") continue;
    if (error) throw error;
    const clock = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:${pad(minute)}`;
    const period = hour < 10 ? "morning" : hour < 13 ? "noon" : hour < 17 ? "afternoon" : "evening";
    return {
      id: data.id,
      startTime,
      endTime,
      label: `${clock(hour)}–${clock(hour + 2)} ${periods[period]}`,
    };
  }
  throw new Error("No free slot time");
}

/** Switched off, as the app does (slots are never deleted). */
export async function disableSlot(id: number) {
  await admin.from("slots").update({ active: false }).eq("id", id).throwOnError();
}

/** A Baghdad calendar date, `days` from today ("2026-10-26"). */
export function baghdadDate(days: number): string {
  const baghdad = new Date(Date.now() + 3 * 60 * 60 * 1000 + days * 24 * 60 * 60 * 1000);
  return baghdad.toISOString().slice(0, 10);
}

export async function userIdFor(phone: string): Promise<string> {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", e164(phone))
    .single()
    .throwOnError();
  return data.id;
}

/**
 * Takes every free place in the slot that day with orders for this customer,
 * as other customers booking first would.
 */
export async function fillSlot(slot: TestSlot, date: string, phone: string) {
  const customerId = await userIdFor(phone);
  const { data: address } = await admin
    .from("addresses")
    .select("id, district, landmark, lat, lng")
    .eq("user_id", customerId)
    .limit(1)
    .single()
    .throwOnError();
  const { data: row } = await admin
    .from("slots")
    .select("capacity")
    .eq("id", slot.id)
    .single()
    .throwOnError();
  const { count } = await admin
    .from("slot_bookings")
    .select("*", { count: "exact", head: true })
    .eq("slot_id", slot.id)
    .eq("service_date", date);

  for (let seat = (count ?? 0) + 1; seat <= row.capacity; seat++) {
    const { data: order } = await admin
      .from("orders")
      .insert({
        customer_id: customerId,
        address_id: address.id,
        district: address.district,
        landmark: address.landmark,
        lat: address.lat,
        lng: address.lng,
        service_date: date,
        slot_id: slot.id,
        slot_start_at: `${date}T${slot.startTime}:00+03:00`,
        slot_end_at: `${date}T${slot.endTime}:00+03:00`,
        total_iqd: 35000,
        client_request_id: randomUUID(),
      })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("slot_bookings")
      .insert({ service_date: date, slot_id: slot.id, seat, order_id: order.id })
      .throwOnError();
  }
}
