import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

import {
  cleanUp,
  handleRequest,
  SECRET_HEADER,
} from "../../supabase/functions/media-cleanup/cleanup";

// The media-cleanup job (spec §7 Storage) against the real local database and
// Storage: unattached_media() picks the files and the Storage API deletes
// them, the stored file included. A booked customer file, a recent one and
// a crew file on an open job stay. Ages are set by backdating
// storage.objects.created_at with psql (the job's rules are in pgTAP:
// unattached_media.test.sql).

const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as { API_URL: string; DB_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string };

type Client = SupabaseClient<Database>;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient<Database>(status.API_URL, status.SECRET_KEY, noSession);
const bucket = () => service.storage.from("order-media");

const runId = String(Date.now()).slice(-6);
const userIds: string[] = [];
const slotIds: number[] = [];
const paths: string[] = [];
const jpeg = readFileSync(new URL("../e2e/fixtures/tank.jpg", import.meta.url));

async function account(n: number, role: "customer" | "admin" = "customer") {
  const phone = `+96478${runId}${String(n).padStart(2, "0")}`;
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

const quoted = (names: string[]) =>
  names.map((name) => `'${name.replaceAll("'", "''")}'`).join(", ");

/** Runs SQL as postgres on the local database; returns the bare output. */
function sql(query: string) {
  return execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", "-qAtc", query], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

/** Makes the files look uploaded `hours` ago. */
function backdate(names: string[], hours: number) {
  sql(`update storage.objects set created_at = now() - interval '${hours} hours'
       where bucket_id = 'order-media' and name in (${quoted(names)})`);
}

/** How many of the names still have a storage.objects row. */
function objectRows(names: string[]) {
  return Number(
    sql(`select count(*) from storage.objects
         where bucket_id = 'order-media' and name in (${quoted(names)})`),
  );
}

async function upload(client: Client, path: string) {
  paths.push(path);
  const { error } = await client.storage
    .from("order-media")
    .upload(path, jpeg, { contentType: "image/jpeg" });
  expect(error).toBeNull();
}

async function exists(path: string) {
  const { data, error } = await bucket().download(path);
  return error === null && data !== null;
}

/** Every name the folder lists now (the local database is small). */
async function listed(folder: "customer" | "crew") {
  const { data, error } = await service.rpc("unattached_media", {
    p_folder: folder,
    p_limit: 1000,
  });
  expect(error).toBeNull();
  return (data ?? []).map((row) => row.name);
}

let customerId: string;
let crewId: string;
let orderId: string;
const file = () => `${randomUUID()}.jpg`;
const customerPath = (name: string) => `customer/${customerId}/${name}`;

beforeAll(async () => {
  const [adminAccount, customerAccount, crewAccount] = await Promise.all([
    account(0, "admin"),
    account(1),
    account(2),
  ]);
  customerId = customerAccount.id;
  const [admin, customer] = await Promise.all([adminAccount.signIn(), customerAccount.signIn()]);

  const created = await admin.rpc("admin_create_crew", {
    p_phone: crewAccount.phone,
    p_name: `فريق ${runId}`,
  });
  expect(created.error).toBeNull();
  crewId = created.data!;
  const crew = await crewAccount.signIn();

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
  const minute = Number(runId) % 1380;
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

  // A booking with one file, which create_order attaches.
  const bookedPath = customerPath(file());
  await upload(customer, bookedPath);
  const order = await customer.rpc("create_order", {
    p_request_id: randomUUID(),
    p_address_id: address!.id,
    p_service_date: day.toISOString().slice(0, 10),
    p_slot_id: slot!.id,
    p_items: [{ tank_type: "roof", size: "m", qty: 1 }],
    p_media: [{ path: bookedPath }],
  });
  expect(order.error).toBeNull();
  orderId = (order.data as { order_id: string }).order_id;
  booked = bookedPath;

  for (const step of [
    () => admin.rpc("transition_order", { p_order_id: orderId, p_to_status: "confirmed" }),
    () => admin.rpc("assign_crew", { p_order_id: orderId, p_crew_id: crewId }),
    () => crew.rpc("transition_order", { p_order_id: orderId, p_to_status: "on_the_way" }),
    () => crew.rpc("transition_order", { p_order_id: orderId, p_to_status: "arrived" }),
  ]) {
    const { error } = await step();
    expect(error).toBeNull();
  }

  // Abandoned booking files, one recent; a crew file on the open job, not yet
  // attached; and one for an order that doesn't exist (only the service
  // role can put it there).
  abandoned = [customerPath(file()), customerPath(file())];
  recent = customerPath(file());
  openJob = `crew/${crewId}/${orderId}/${file()}`;
  noOrder = `crew/${crewId}/${randomUUID()}/${file()}`;
  for (const path of [...abandoned, recent]) await upload(customer, path);
  await upload(crew, openJob);
  await upload(service, noOrder);
  backdate([...abandoned, booked, openJob, noOrder], 24 * 30);
  backdate([recent], 71);
});

let booked: string;
let abandoned: string[];
let recent: string;
let openJob: string;
let noOrder: string;

afterAll(async () => {
  if (paths.length > 0) await bucket().remove(paths);
  await service.from("orders").delete().in("customer_id", userIds);
  await service.from("crews").delete().in("user_id", userIds);
  await service.from("admin_audit_log").delete().in("admin_id", userIds);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  await service.from("slots").delete().in("id", slotIds);
});

describe("media cleanup", () => {
  it("lists only what may go", async () => {
    const customer = await listed("customer");
    expect(customer).toEqual(expect.arrayContaining(abandoned));
    expect(customer).not.toContain(booked);
    expect(customer).not.toContain(recent);

    const crew = await listed("crew");
    expect(crew).toContain(noOrder);
    expect(crew).not.toContain(openJob);
  });

  it("refuses everyone but the service role", async () => {
    const guest = createClient<Database>(status.API_URL, status.PUBLISHABLE_KEY, noSession);
    const { error } = await guest.rpc("unattached_media", { p_folder: "customer" });
    expect(error?.code).toBe("42501");
  });

  it("deletes abandoned booking files from Storage, stored files included", async () => {
    for (const path of abandoned) expect(await exists(path)).toBe(true);
    expect(objectRows(abandoned)).toBe(abandoned.length);

    // One file per page, so every page after the first goes through the
    // cursor (an upload time from PostgREST, sent back as given).
    const result = await cleanUp(service as unknown as SupabaseClient, "customer", {
      pageSize: 1,
      chunkSize: 1,
      maxPages: 1000,
      budgetMs: 60_000,
    });
    expect(result.deleted).toBeGreaterThanOrEqual(abandoned.length);
    expect(result).toMatchObject({ failed: 0, more: false });

    for (const path of abandoned) expect(await exists(path)).toBe(false);
    expect(objectRows(abandoned)).toBe(0);
    expect(await exists(booked)).toBe(true);
    expect(await exists(recent)).toBe(true);
  });

  it("runs as the Edge Function does: secret, real client, crew folder", async () => {
    const secret = randomBytes(24).toString("base64url");
    const env = { secret, url: status.API_URL, serviceKey: status.SECRET_KEY };
    const request = (header: string) =>
      new Request("http://functions.test/media-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json", [SECRET_HEADER]: header },
        body: JSON.stringify({ folder: "crew" }),
      });

    const refused = await handleRequest(request("wrong"), env);
    expect(refused.status).toBe(401);
    expect(await exists(noOrder)).toBe(true);

    const res = await handleRequest(request(secret), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { folder: string; deleted: number; failed: number };
    expect(body.folder).toBe("crew");
    expect(body.deleted).toBeGreaterThanOrEqual(1);
    expect(body.failed).toBe(0);

    expect(await exists(noOrder)).toBe(false);
    expect(await exists(openJob)).toBe(true);
  });

  it("deletes certificate PDFs no certificate records, after 24 hours", async () => {
    const pdfs = service.storage.from("certificates");
    const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
    const stray = `${randomUUID()}/1.pdf`;
    const fresh = `${randomUUID()}/2.pdf`;
    for (const path of [stray, fresh]) {
      const { error } = await pdfs.upload(path, pdf, { contentType: "application/pdf" });
      expect(error).toBeNull();
    }
    sql(`update storage.objects set created_at = now() - interval '25 hours'
         where bucket_id = 'certificates' and name = ${quoted([stray])}`);

    const result = await cleanUp(service as unknown as SupabaseClient, "certificate");
    expect(result).toMatchObject({ folder: "certificate", failed: 0, more: false });
    expect(result.deleted).toBeGreaterThanOrEqual(1);

    expect((await pdfs.download(stray)).error).not.toBeNull();
    expect((await pdfs.download(fresh)).error).toBeNull();
    await pdfs.remove([fresh]);
  });

  it("finds nothing more on a second run", async () => {
    expect(await listed("customer")).toEqual([]);
    expect(await listed("crew")).toEqual([]);
  });
});
