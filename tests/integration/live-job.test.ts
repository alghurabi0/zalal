import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

// The live job through the real Realtime service (spec §5.13, §5.14, §8.2 A3):
// a crew position shared over the API reaches the order's customer and an
// admin, and a crew photo attached on arrival reaches the customer, while
// another customer subscribed to the same tables gets nothing. Channels join
// with the user's token (setAuth), as the screens do, so RLS decides.

const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as { API_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string };

type Client = SupabaseClient<Database>;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient<Database>(status.API_URL, status.SECRET_KEY, noSession);

const runId = String(Date.now()).slice(-6);
const userIds: string[] = [];
const slotIds: number[] = [];
const paths: string[] = [];
const channels: { client: Client; channel: RealtimeChannel }[] = [];
const jpeg = readFileSync(new URL("../e2e/fixtures/tank.jpg", import.meta.url));

async function account(n: number, role: "customer" | "admin" = "customer") {
  const phone = `+96479${runId}${String(n).padStart(2, "0")}`;
  const password = randomBytes(32).toString("base64url");
  const { data, error } = await service.auth.admin.createUser({
    phone,
    phone_confirm: true,
    password,
  });
  expect(error).toBeNull();
  const id = data.user!.id;
  userIds.push(id);
  if (role === "admin") {
    await service.from("profiles").update({ role, full_name: "مشرف" }).eq("id", id).throwOnError();
  }
  const signIn = async () => {
    const client = createClient<Database>(status.API_URL, status.PUBLISHABLE_KEY, noSession);
    const { error: signInError } = await client.auth.signInWithPassword({ phone, password });
    expect(signInError).toBeNull();
    return client;
  };
  return { id, phone, signIn };
}

type Received = Record<string, unknown>[];

/**
 * Subscribes to INSERT and UPDATE on a table with the user's token, and
 * resolves once Postgres changes are live. `filter` narrows it as the screens
 * do; without one, RLS alone decides what arrives.
 */
async function listen(
  client: Client,
  table: "crew_live_location" | "order_media",
  filter?: string,
): Promise<Received> {
  const { data } = await client.auth.getSession();
  await client.realtime.setAuth(data.session!.access_token);
  const received: Received = [];
  const channel = client.channel(`test:${table}:${randomUUID()}`);
  for (const event of ["INSERT", "UPDATE"] as const) {
    channel.on(
      "postgres_changes",
      { event, schema: "public", table, ...(filter ? { filter } : {}) },
      (payload) => received.push(payload.new),
    );
  }
  await new Promise<void>((resolve, reject) => {
    channel.on("system", {}, (message: { extension?: string; status?: string }) => {
      if (message.extension === "postgres_changes" && message.status === "ok") resolve();
    });
    channel.subscribe((state, error) => {
      if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") reject(error ?? new Error(state));
    });
  });
  channels.push({ client, channel });
  return received;
}

async function until(check: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
}

let admin: Client;
let customer: Client;
let stranger: Client;
let crew: Client;
let crewId: string;
let orderId: string;

beforeAll(async () => {
  const [adminAccount, customerAccount, strangerAccount, crewAccount] = await Promise.all([
    account(0, "admin"),
    account(1),
    account(2),
    account(3),
  ]);
  [admin, customer, stranger] = await Promise.all([
    adminAccount.signIn(),
    customerAccount.signIn(),
    strangerAccount.signIn(),
  ]);

  const created = await admin.rpc("admin_create_crew", {
    p_phone: crewAccount.phone,
    p_name: `فريق ${runId}`,
  });
  expect(created.error).toBeNull();
  crewId = created.data!;
  crew = await crewAccount.signIn();

  const { data: address } = await customer
    .from("addresses")
    .insert({
      label: "home",
      district: "حي الحسين",
      landmark: "قرب الجامع",
      lat: 32.616,
      lng: 44.024,
    })
    .select("id")
    .single()
    .throwOnError();
  const minute = (Number(runId) + 700) % 1380;
  const time = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const { data: slot } = await service
    .from("slots")
    .insert({
      start_time: time(minute),
      end_time: time(minute + 30),
      capacity: 5,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    })
    .select("id")
    .single()
    .throwOnError();
  slotIds.push(slot!.id);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date());
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 2);

  const order = await customer.rpc("create_order", {
    p_request_id: randomUUID(),
    p_address_id: address!.id,
    p_service_date: day.toISOString().slice(0, 10),
    p_slot_id: slot!.id,
    p_items: [{ tank_type: "roof", size: "m", qty: 1 }],
  });
  expect(order.error).toBeNull();
  orderId = (order.data as { order_id: string }).order_id;

  for (const step of [
    () => admin.rpc("transition_order", { p_order_id: orderId, p_to_status: "confirmed" }),
    () => admin.rpc("assign_crew", { p_order_id: orderId, p_crew_id: crewId }),
    () => crew.rpc("transition_order", { p_order_id: orderId, p_to_status: "on_the_way" }),
  ]) {
    const { error } = await step();
    expect(error).toBeNull();
  }
}, 30000);

afterAll(async () => {
  for (const { client, channel } of channels) await client.removeChannel(channel);
  if (paths.length > 0) await service.storage.from("order-media").remove(paths);
  await service.from("orders").delete().in("customer_id", userIds);
  await service.from("crews").delete().in("user_id", userIds);
  await service.from("admin_audit_log").delete().in("admin_id", userIds);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  await service.from("slots").delete().in("id", slotIds);
});

describe("live job over Realtime", () => {
  it("sends the crew's position to the customer and admins only", async () => {
    const [mine, theirs, admins] = await Promise.all([
      listen(customer, "crew_live_location", `order_id=eq.${orderId}`),
      listen(stranger, "crew_live_location"),
      listen(admin, "crew_live_location"),
    ]);

    const shared = await crew.rpc("share_crew_location", {
      p_order_id: orderId,
      p_lat: 32.6,
      p_lng: 44.01,
      p_accuracy_m: 8.4,
    });
    expect(shared.error).toBeNull();
    expect(shared.data).toBe(true);

    await until(() => mine.length > 0 && admins.length > 0);
    expect(mine[0]).toMatchObject({
      order_id: orderId,
      crew_id: crewId,
      lat: 32.6,
      lng: 44.01,
      accuracy_m: 8,
    });
    expect(admins.some((row) => row.order_id === orderId)).toBe(true);
    // Give a leak the same time to arrive before checking there was none.
    await new Promise((r) => setTimeout(r, 1500));
    expect(theirs).toEqual([]);

    const again = await crew.rpc("share_crew_location", {
      p_order_id: orderId,
      p_lat: 32.61,
      p_lng: 44.02,
      p_accuracy_m: 5,
    });
    expect(again.data).toBe(false);
  }, 20000);

  it("sends a crew photo attached on arrival to the customer only", async () => {
    const arrived = await crew.rpc("transition_order", {
      p_order_id: orderId,
      p_to_status: "arrived",
    });
    expect(arrived.error).toBeNull();

    const [mine, theirs] = await Promise.all([
      listen(customer, "order_media", `order_id=eq.${orderId}`),
      listen(stranger, "order_media"),
    ]);

    const path = `crew/${crewId}/${orderId}/${randomUUID()}.jpg`;
    paths.push(path);
    const upload = await crew.storage
      .from("order-media")
      .upload(path, jpeg, { contentType: "image/jpeg" });
    expect(upload.error).toBeNull();
    const attached = await crew.rpc("attach_job_media", {
      p_order_id: orderId,
      p_kind: "before",
      p_path: path,
    });
    expect(attached.error).toBeNull();

    await until(() => mine.length > 0);
    expect(mine[0]).toMatchObject({ id: attached.data, order_id: orderId, kind: "before" });
    await new Promise((r) => setTimeout(r, 1500));
    expect(theirs).toEqual([]);
  }, 20000);
});
