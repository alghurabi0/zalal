import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

import { cleanUp } from "../../supabase/functions/media-cleanup/cleanup";

// Chat (spec §5.16, A4) through the real API and Storage: a customer uploads
// to chat-media and sends it with send_chat_message over PostgREST (which
// loads pg-safeupdate, unlike pgTAP), support answers and reads, the sent
// file can no longer be deleted, both sides get signed links, and the
// nightly cleanup deletes only an unsent old upload.

const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as { API_URL: string; DB_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string };

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient<Database>(status.API_URL, status.SECRET_KEY, noSession);
const runId = String(Date.now()).slice(-6);
const userIds: string[] = [];
const paths: string[] = [];
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
    await service.from("profiles").update({ role, full_name: "دعم" }).eq("id", id).throwOnError();
  }
  const client = createClient<Database>(status.API_URL, status.PUBLISHABLE_KEY, noSession);
  const { error: signInError } = await client.auth.signInWithPassword({ phone, password });
  expect(signInError).toBeNull();
  return { id, client };
}

async function upload(client: Account["client"] | typeof service, path: string) {
  paths.push(path);
  const { error } = await client.storage
    .from("chat-media")
    .upload(path, jpeg, { contentType: "image/jpeg" });
  expect(error).toBeNull();
}

function sql(query: string) {
  return execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", "-qAtc", query], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

type Account = Awaited<ReturnType<typeof account>>;
let customer: Account;
let support: Account;
let threadId: string;
const sent = () => `${customer.id}/${randomUUID()}.jpg`;

beforeAll(async () => {
  [customer, support] = await Promise.all([account(1), account(2, "admin")]);
  // Inside hours, so no automatic reply joins the thread.
  sql(`update public.settings set working_days = '{0,1,2,3,4,5,6}',
       working_hours_start = '00:00', working_hours_end = '24:00' where id`);
});

afterAll(async () => {
  await service.storage.from("chat-media").remove(paths);
  await service.from("chat_messages").delete().in("customer_id", userIds);
  await service.from("chat_threads").delete().in("user_id", userIds);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  sql(`update public.settings set working_days = '{0,1,2,3,4,6}',
       working_hours_start = '09:00', working_hours_end = '21:00' where id`);
});

describe("chat over the API", () => {
  let photo: string;

  it("sends a photo the customer uploaded, once", async () => {
    photo = sent();
    await upload(customer.client, photo);
    const clientId = randomUUID();
    const first = await customer.client.rpc("send_chat_message", {
      p_client_id: clientId,
      p_body: "التسريب",
      p_media_path: photo,
    });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ media_type: "photo", body: "التسريب", author: "customer" });
    threadId = first.data!.thread_id;

    const retry = await customer.client.rpc("send_chat_message", {
      p_client_id: clientId,
      p_body: "التسريب",
      p_media_path: photo,
    });
    expect(retry.data?.id).toBe(first.data!.id);
  });

  it("keeps a sent file: the customer can't delete it", async () => {
    const { data } = await customer.client.storage.from("chat-media").remove([photo]);
    expect(data).toEqual([]);
    const { data: still } = await service.storage.from("chat-media").download(photo);
    expect(still).not.toBeNull();
  });

  it("lets support read it, answer and mark it read; the customer sees the answer", async () => {
    const link = await support.client.storage.from("chat-media").createSignedUrl(photo, 60);
    expect(link.error).toBeNull();

    const answer = await support.client.rpc("send_chat_message", {
      p_client_id: randomUUID(),
      p_thread_id: threadId,
      p_body: "وصلت الصورة",
    });
    expect(answer.error).toBeNull();

    const marked = await support.client.rpc("mark_chat_read", { p_thread_id: threadId });
    expect(marked).toMatchObject({ error: null, data: 1 });
    const read = await customer.client.rpc("mark_chat_read", { p_thread_id: threadId });
    expect(read).toMatchObject({ error: null, data: 1 });

    const { data: thread } = await customer.client
      .from("chat_threads")
      .select("customer_unread, admin_unread")
      .single()
      .throwOnError();
    expect(thread).toEqual({ customer_unread: 0, admin_unread: 0 });
    const { data: messages } = await customer.client
      .from("chat_messages")
      .select("body, read_at")
      .order("created_at")
      .throwOnError();
    expect(messages.map((m) => [m.body, m.read_at !== null])).toEqual([
      ["التسريب", true],
      ["وصلت الصورة", true],
    ]);
  });

  it("cleans only an unsent upload more than 72 hours old", async () => {
    const old = sent();
    const fresh = sent();
    await upload(customer.client, old);
    await upload(customer.client, fresh);
    sql(`update storage.objects set created_at = now() - interval '80 hours'
         where bucket_id = 'chat-media' and name in ('${old}', '${photo}')`);

    const result = await cleanUp(service as unknown as SupabaseClient, "chat");
    expect(result).toMatchObject({ failed: 0, more: false });
    expect(result.deleted).toBeGreaterThanOrEqual(1);

    const exists = async (path: string) =>
      (await service.storage.from("chat-media").download(path)).data !== null;
    expect(await exists(old)).toBe(false);
    expect(await exists(fresh)).toBe(true);
    expect(await exists(photo)).toBe(true);
  });
});
