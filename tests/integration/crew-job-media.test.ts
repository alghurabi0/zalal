import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DetailedError, Upload } from "tus-js-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

// The crew's job media and finish form (spec §8.1 C3b, C4) through the real
// services: a TUS upload to Storage with the crew's session (the storage
// policies), attach_job_media and remove_job_media over the API (where
// pg-safeupdate refuses an UPDATE or DELETE without a WHERE), the Storage
// API's own delete, and the C4 completion that writes job_reports.

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

/** Uploads over TUS as the client's user; resolves with "done" or the HTTP status. */
async function tusUpload(client: Client, path: string, body: Buffer, contentType = "image/jpeg") {
  const { data } = await client.auth.getSession();
  return new Promise<"done" | number | null>((resolve) => {
    const upload = new Upload(body, {
      endpoint: `${status.API_URL}/storage/v1/upload/resumable`,
      retryDelays: [],
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      storeFingerprintForResuming: false,
      headers: {
        apikey: status.PUBLISHABLE_KEY,
        authorization: `Bearer ${data.session!.access_token}`,
        "x-upsert": "false",
      },
      metadata: { bucketName: "order-media", objectName: path, contentType },
      onSuccess: () => resolve("done"),
      onError: (error) =>
        resolve(
          error instanceof DetailedError ? (error.originalResponse?.getStatus() ?? null) : null,
        ),
    });
    upload.start();
  });
}

let admin: Client;
let customer: Client;
let crew: Client;
let crewId: string;
let orderId: string;
const folder = () => `crew/${crewId}/${orderId}`;

beforeAll(async () => {
  const [adminAccount, customerAccount, crewAccount] = await Promise.all([
    account(0, "admin"),
    account(1),
    account(2),
  ]);
  [admin, customer] = await Promise.all([adminAccount.signIn(), customerAccount.signIn()]);

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
    () => crew.rpc("transition_order", { p_order_id: orderId, p_to_status: "arrived" }),
  ]) {
    const { error } = await step();
    expect(error).toBeNull();
  }
});

afterAll(async () => {
  if (paths.length > 0) await service.storage.from("order-media").remove(paths);
  await service.from("orders").delete().in("customer_id", userIds);
  await service.from("crews").delete().in("user_id", userIds);
  await service.from("admin_audit_log").delete().in("admin_id", userIds);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  await service.from("slots").delete().in("id", slotIds);
});

describe("crew job media", () => {
  let mediaId: string;
  const before = () => `${folder()}/${"1".repeat(8)}-1111-4111-8111-111111111111.jpg`;

  it("uploads a before photo over TUS and attaches it, twice safely", async () => {
    paths.push(before());
    expect(await tusUpload(crew, before(), jpeg)).toBe("done");

    const first = await crew.rpc("attach_job_media", {
      p_order_id: orderId,
      p_kind: "before",
      p_path: before(),
    });
    expect(first.error).toBeNull();
    mediaId = first.data!;
    const again = await crew.rpc("attach_job_media", {
      p_order_id: orderId,
      p_kind: "before",
      p_path: before(),
    });
    expect(again.data).toBe(mediaId);

    const { data: row } = await service
      .from("order_media")
      .select("kind, media_type, bytes")
      .eq("id", mediaId)
      .single();
    expect(row).toEqual({ kind: "before", media_type: "photo", bytes: jpeg.length });
  });

  it("answers 409 to the same file again, which the queue treats as uploaded", async () => {
    expect(await tusUpload(crew, before(), jpeg)).toBe(409);
  });

  it("refuses the customer's session in the crew folder", async () => {
    const path = `${folder()}/${"2".repeat(8)}-2222-4222-8222-222222222222.jpg`;
    paths.push(path);
    const result = await tusUpload(customer, path, jpeg);
    expect(result).not.toBe("done");
    expect(typeof result === "number" && result >= 400 && result < 500).toBe(true);
  });

  it("removes the photo and lets the crew delete the file through Storage", async () => {
    const { data: path, error } = await crew.rpc("remove_job_media", { p_media_id: mediaId });
    expect(error).toBeNull();
    expect(path).toBe(before());

    const removed = await crew.storage.from("order-media").remove([before()]);
    expect(removed.error).toBeNull();
    const { data: left } = await service.storage.from("order-media").list(folder());
    expect(left?.map((file) => file.name) ?? []).not.toContain(before().split("/").pop());
  });

  it("completes with the C4 form, and a late upload still lands", async () => {
    const started = await crew.rpc("transition_order", {
      p_order_id: orderId,
      p_to_status: "in_progress",
    });
    expect(started.error).toBeNull();
    const done = await crew.rpc("transition_order", {
      p_order_id: orderId,
      p_to_status: "completed",
      p_payload: {
        cash_collected: true,
        sterilant: "كلور الصوديوم",
        residual_chlorine_mg_l: 0.5,
        note: "الخزان يحتاج غطا",
      },
    });
    expect(done.error).toBeNull();

    const { data: report } = await customer
      .from("job_reports")
      .select("sterilant, residual_chlorine_mg_l")
      .eq("order_id", orderId)
      .single();
    expect(report).toEqual({ sterilant: "كلور الصوديوم", residual_chlorine_mg_l: 0.5 });
    const { data: notes } = await customer.from("order_event_notes").select("note");
    expect(notes).toEqual([]);

    const after = `${folder()}/${"3".repeat(8)}-3333-4333-8333-333333333333.jpg`;
    paths.push(after);
    expect(await tusUpload(crew, after, jpeg)).toBe("done");
    const attached = await crew.rpc("attach_job_media", {
      p_order_id: orderId,
      p_kind: "after",
      p_path: after,
    });
    expect(attached.error).toBeNull();
  });
});
