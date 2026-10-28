import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

// Subscription visits (spec §5.11, §6; Phase 6, task 2): bookings that use
// the subscription at the same moment cannot spend more visits than it has.
// create_order locks the subscription row; this runs real sessions in
// parallel over the API, which pgTAP (one transaction) can't.

const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as { API_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string };

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient<Database>(status.API_URL, status.SECRET_KEY, noSession);

const runId = String(Date.now()).slice(-6);
let userId = "";
let slotId = 0;
let client: SupabaseClient<Database>;
let addressId = "";

/** A day in Baghdad, `days` from today: inside the window, past the cutoff. */
function day(days: number) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

beforeAll(async () => {
  const phone = `+96477${runId}91`;
  const password = randomBytes(32).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    phone,
    phone_confirm: true,
    password,
  });
  expect(error).toBeNull();
  userId = data.user!.id;

  client = createClient<Database>(status.API_URL, status.PUBLISHABLE_KEY, noSession);
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
  addressId = address!.id;

  const minute = (Number(runId) + 7) % 1380;
  const time = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const { data: slot, error: slotError } = await admin
    .from("slots")
    .insert({
      start_time: time(minute),
      end_time: time(minute + 30),
      capacity: 20,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    })
    .select("id")
    .single();
  expect(slotError).toBeNull();
  slotId = slot!.id;

  // One visit left: active from today for 12 months.
  const startsOn = day(0);
  const end = new Date(`${startsOn}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 12);
  end.setUTCDate(end.getUTCDate() - 1);
  const { error: subscriptionError } = await admin.from("subscriptions").insert({
    user_id: userId,
    address_id: addressId,
    status: "active",
    price_iqd: 60000,
    visits_total: 1,
    tanks_covered: 1,
    starts_on: startsOn,
    ends_on: end.toISOString().slice(0, 10),
    activated_at: new Date().toISOString(),
  });
  expect(subscriptionError).toBeNull();
});

afterAll(async () => {
  await admin.from("orders").delete().eq("customer_id", userId);
  await admin.from("subscriptions").delete().eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId);
  await admin.from("slots").delete().eq("id", slotId);
});

describe("subscription visits", () => {
  it("covers exactly one of five parallel bookings when one visit is left", async () => {
    const results = await Promise.all(
      [2, 3, 4, 5, 6].map((days) =>
        client.rpc("create_order", {
          p_request_id: randomUUID(),
          p_address_id: addressId,
          p_service_date: day(days),
          p_slot_id: slotId,
          p_items: [{ tank_type: "roof", size: "m", qty: 1 }],
          p_use_subscription: true,
        }),
      ),
    );

    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    const refused = results.filter((r) => r.error !== null);
    expect(refused).toHaveLength(4);
    for (const r of refused) {
      expect(r.error).toMatchObject({ code: "ZL034", message: "no_visits_left" });
    }
    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", userId)
      .not("subscription_id", "is", null);
    expect(count).toBe(1);
  });
});
