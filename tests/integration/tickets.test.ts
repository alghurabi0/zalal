import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

import { cleanUp } from "../../supabase/functions/media-cleanup/cleanup";

// The Issue report and A5 (spec §5.17, §8.2) through the real API and
// Storage: a customer uploads to ticket-media and reports with
// create_ticket over PostgREST (which loads pg-safeupdate, unlike pgTAP);
// the attached file can't be deleted or replaced; support signs it, changes
// the status and keeps a note; the nightly cleanup deletes only an
// unattached old upload.

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
    await service.from("profiles").update({ role, full_name: "دعم" }).eq("id", id).throwOnError();
  }
  const client = createClient<Database>(status.API_URL, status.PUBLISHABLE_KEY, noSession);
  const { error: signInError } = await client.auth.signInWithPassword({ phone, password });
  expect(signInError).toBeNull();
  return { id, client };
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
let ticketId: string;
let photo: string;

beforeAll(async () => {
  [customer, support] = await Promise.all([account(1), account(2, "admin")]);
});

afterAll(async () => {
  await service.storage.from("ticket-media").remove(paths);
  await service.from("ticket_notes").delete().in("author_id", userIds);
  await service.from("ticket_media").delete().in("user_id", userIds);
  await service.from("chat_messages").delete().in("customer_id", userIds);
  await service.from("chat_threads").delete().in("user_id", userIds);
  await service.from("admin_audit_log").delete().in("admin_id", userIds);
  await service.from("tickets").delete().in("user_id", userIds);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
});

describe("the Issue report over the API", () => {
  it("reports with an uploaded photo, once", async () => {
    photo = `${customer.id}/${randomUUID()}.jpg`;
    paths.push(photo);
    const { error: uploadError } = await customer.client.storage
      .from("ticket-media")
      .upload(photo, jpeg, { contentType: "image/jpeg" });
    expect(uploadError).toBeNull();

    const clientId = randomUUID();
    const first = await customer.client
      .rpc("create_ticket", {
        p_client_id: clientId,
        p_category: "leak",
        p_description: "تسريب من الغطاء بعد التنظيف",
        p_media: [{ path: photo }],
      })
      .single();
    expect(first.error).toBeNull();
    ticketId = first.data!.ticket_id;
    expect(first.data!.ticket_number).toBeGreaterThanOrEqual(1001);

    const retry = await customer.client
      .rpc("create_ticket", {
        p_client_id: clientId,
        p_category: "leak",
        p_description: "تسريب من الغطاء بعد التنظيف",
        p_media: [{ path: photo }],
      })
      .single();
    expect(retry.data?.ticket_id).toBe(ticketId);

    const { data: media } = await customer.client
      .from("ticket_media")
      .select("media_type, bytes")
      .eq("ticket_id", ticketId)
      .throwOnError();
    expect(media).toEqual([{ media_type: "photo", bytes: jpeg.length }]);

    const { data: message } = await customer.client
      .from("chat_messages")
      .select("kind, author")
      .eq("ticket_id", ticketId)
      .single()
      .throwOnError();
    expect(message).toEqual({ kind: "ticket", author: "system" });
  });

  it("keeps the attached file: no delete and no replacement", async () => {
    const { data } = await customer.client.storage.from("ticket-media").remove([photo]);
    expect(data).toEqual([]);
    const { error } = await customer.client.storage
      .from("ticket-media")
      .upload(photo, jpeg, { contentType: "image/jpeg", upsert: true });
    expect(error).not.toBeNull();
    const { data: still } = await service.storage.from("ticket-media").download(photo);
    expect(still).not.toBeNull();
  });

  it("lets support sign the file, change the status and add a note; the customer can't", async () => {
    const { data: signed, error: signError } = await support.client.storage
      .from("ticket-media")
      .createSignedUrl(photo, 60);
    expect(signError).toBeNull();
    expect(signed?.signedUrl).toContain("/ticket-media/");

    const set = await support.client.rpc("admin_set_ticket_status", {
      p_ticket_id: ticketId,
      p_status: "in_progress",
    });
    expect(set.error).toBeNull();
    const note = await support.client.rpc("admin_add_ticket_note", {
      p_ticket_id: ticketId,
      p_note: "نرجع الفريق باجر",
    });
    expect(note.error).toBeNull();

    const { data: ticket } = await customer.client
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single()
      .throwOnError();
    expect(ticket.status).toBe("in_progress");
    const { data: notes } = await customer.client.from("ticket_notes").select("id").throwOnError();
    expect(notes).toEqual([]);

    const denied = await customer.client.rpc("admin_set_ticket_status", {
      p_ticket_id: ticketId,
      p_status: "closed",
    });
    expect(denied.error?.code).toBe("42501");
  });

  it("deletes only an unattached old upload in the nightly cleanup", async () => {
    const old = `${customer.id}/${randomUUID()}.jpg`;
    paths.push(old);
    await customer.client.storage
      .from("ticket-media")
      .upload(old, jpeg, { contentType: "image/jpeg" });
    sql(`update storage.objects set created_at = now() - interval '4 days'
         where bucket_id = 'ticket-media' and name in ('${old}', '${photo}')`);

    const result = await cleanUp(service as unknown as SupabaseClient, "ticket");
    expect(result.failed).toBe(0);
    const { data: gone } = await service.storage.from("ticket-media").download(old);
    expect(gone).toBeNull();
    const { data: kept } = await service.storage.from("ticket-media").download(photo);
    expect(kept).not.toBeNull();
  });
});
