import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import type { Database } from "../../../src/lib/database.types";

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

/** Picks the day (by date) and the test's slot in the day and slot chips. */
export async function pickSlot(page: Page, date: string, label: string) {
  await page
    .locator("label")
    .filter({ visible: true })
    .filter({ has: page.locator(`input[name$="-day"][value="${date}"]`) })
    .click();
  // The radio itself is visually hidden; tap its chip like a customer would.
  await page.locator("label").filter({ visible: true }).filter({ hasText: label }).click();
  await expect(
    page.getByRole("radio", { name: new RegExp(label) }).filter({ visible: true }),
  ).toBeChecked();
}

type OrderStatus = Database["public"]["Enums"]["order_status"];

type TestLine = {
  tank_type: "roof" | "ground";
  size: "s" | "m" | "l";
  qty: number;
  unit_price_iqd: number;
};

/**
 * An order for this customer at their first address, written directly, as
 * booking and staff would have left it: its booking event, a place in the
 * slot unless cancelled, and an event for a status past pending.
 * `startAt` overrides the slot's start time (to sit near the cutoff).
 */
export async function createOrder(
  phone: string,
  {
    slot,
    date,
    status = "pending_confirmation",
    startAt,
    lines = [{ tank_type: "roof", size: "m", qty: 1, unit_price_iqd: 35000 }],
    crewId = null,
    note = null,
  }: {
    slot: TestSlot;
    date: string;
    status?: OrderStatus;
    startAt?: Date;
    lines?: TestLine[];
    /** The assigned crew. */
    crewId?: string | null;
    note?: string | null;
  },
): Promise<{ id: string; number: number }> {
  const customerId = await userIdFor(phone);
  const { data: address } = await admin
    .from("addresses")
    .select("id, district, landmark, lat, lng")
    .eq("user_id", customerId)
    .limit(1)
    .single()
    .throwOnError();
  const slotStart = startAt ?? new Date(`${date}T${slot.startTime}:00+03:00`);
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
      slot_start_at: slotStart.toISOString(),
      slot_end_at: new Date(slotStart.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      status,
      crew_id: crewId,
      customer_note: note,
      total_iqd: lines.reduce((sum, l) => sum + l.qty * l.unit_price_iqd, 0),
      client_request_id: randomUUID(),
    })
    .select("id, number")
    .single()
    .throwOnError();
  await admin
    .from("order_items")
    .insert(lines.map((line) => ({ ...line, order_id: order.id })))
    .throwOnError();
  await admin
    .from("order_events")
    .insert({
      order_id: order.id,
      from_status: null,
      to_status: "pending_confirmation",
      actor_id: customerId,
      actor_role: "customer",
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    })
    .throwOnError();
  if (status !== "pending_confirmation") {
    await admin
      .from("order_events")
      .insert({
        order_id: order.id,
        from_status: "pending_confirmation",
        to_status: status,
        actor_role: "admin",
      })
      .throwOnError();
  }
  if (status !== "cancelled") {
    const { data: taken } = await admin
      .from("slot_bookings")
      .select("seat")
      .eq("slot_id", slot.id)
      .eq("service_date", date)
      .throwOnError();
    const seats = new Set(taken.map((row) => row.seat));
    let seat = 1;
    while (seats.has(seat)) seat++;
    await admin
      .from("slot_bookings")
      .insert({ service_date: date, slot_id: slot.id, seat, order_id: order.id })
      .throwOnError();
  }
  return order;
}
