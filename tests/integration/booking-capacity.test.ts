import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

// Phase 2 "done when" (spec §12.3): parallel bookings cannot overbook the
// last place. Real sessions call create_order over the API at the same time,
// each in its own connection, which the pgTAP tests (one transaction) can't.

const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as { API_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string };

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient<Database>(status.API_URL, status.SECRET_KEY, noSession);

const runId = String(Date.now()).slice(-6);
const userIds: string[] = [];
const slotIds: number[] = [];

type Customer = { client: SupabaseClient<Database>; addressId: string };

async function newCustomer(): Promise<Customer> {
  const phone = `+96477${runId}${String(userIds.length).padStart(2, "0")}`;
  const password = randomBytes(32).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    phone,
    phone_confirm: true,
    password,
  });
  expect(error).toBeNull();
  userIds.push(data.user!.id);

  const client = createClient<Database>(status.API_URL, status.PUBLISHABLE_KEY, noSession);
  const { error: signInError } = await client.auth.signInWithPassword({ phone, password });
  expect(signInError).toBeNull();

  const { data: address, error: addressError } = await client
    .from("addresses")
    .insert({
      label: "home",
      district: "حي الحسين",
      landmark: "قرب الجامع",
      lat: 32.616,
      lng: 44.024,
    })
    .select("id")
    .single();
  expect(addressError).toBeNull();
  return { client, addressId: address!.id };
}

/** A slot open every day, with times unique to this run. */
async function newSlot(capacity: number) {
  const minute = (Number(runId) + slotIds.length) % 1380;
  const time = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const { data, error } = await admin
    .from("slots")
    .insert({
      start_time: time(minute),
      end_time: time(minute + 30),
      capacity,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  slotIds.push(data!.id);
  return data!.id;
}

/** The day after tomorrow in Baghdad: inside the window, past the cutoff. */
function serviceDate() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date());
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 2);
  return day.toISOString().slice(0, 10);
}

function book(customer: Customer, slotId: number, requestId = randomUUID()) {
  return customer.client.rpc("create_order", {
    p_request_id: requestId,
    p_address_id: customer.addressId,
    p_service_date: serviceDate(),
    p_slot_id: slotId,
    p_items: [{ tank_type: "roof", size: "m", qty: 1 }],
  });
}

async function placesHeld(slotId: number) {
  const { count, error } = await admin
    .from("slot_bookings")
    .select("*", { count: "exact", head: true })
    .eq("slot_id", slotId)
    .eq("service_date", serviceDate());
  expect(error).toBeNull();
  return count;
}

let customers: Customer[];

beforeAll(async () => {
  customers = [];
  for (let i = 0; i < 6; i++) customers.push(await newCustomer());
});

afterAll(async () => {
  await admin.from("orders").delete().in("customer_id", userIds);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("slots").delete().in("id", slotIds);
});

describe("booking capacity", () => {
  it("gives the last place to exactly one of six parallel bookings", async () => {
    const slotId = await newSlot(1);

    const results = await Promise.all(customers.map((customer) => book(customer, slotId)));

    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    const refused = results.filter((r) => r.error !== null);
    expect(refused).toHaveLength(5);
    for (const r of refused) expect(r.error).toMatchObject({ code: "ZL005", message: "slot_full" });
    expect(await placesHeld(slotId)).toBe(1);
  });

  it("fills a two-place slot with two of six parallel bookings", async () => {
    const slotId = await newSlot(2);

    const results = await Promise.all(customers.map((customer) => book(customer, slotId)));

    expect(results.filter((r) => r.error === null)).toHaveLength(2);
    expect(results.filter((r) => r.error?.code === "ZL005")).toHaveLength(4);
    expect(await placesHeld(slotId)).toBe(2);
  });

  it("books once when the same checkout is sent twice at the same moment", async () => {
    const slotId = await newSlot(2);
    const requestId = randomUUID();
    const [customer] = customers;
    if (!customer) throw new Error("no customer");

    const [first, second] = await Promise.all([
      book(customer, slotId, requestId),
      book(customer, slotId, requestId),
    ]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data).toEqual(first.data);
    expect(await placesHeld(slotId)).toBe(1);
  });
});
