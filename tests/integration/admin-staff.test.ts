import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ensureAccount } from "@/lib/admin/staff-accounts";
import type { Database } from "@/lib/database.types";
import type { OtpSender, SendResult } from "@/lib/otp/senders";
import { createOtpService } from "@/lib/otp/service";

vi.mock("server-only", () => ({}));

// A10 and A14 end to end against local Supabase (spec §8.2): the account
// from the Auth admin API (ensureAccount, as the Server Actions call it),
// then the admin RPCs over the API with an admin's session, then the new
// crew's or admin's first login by phone code. Also what pgTAP can't show:
// pg-safeupdate (which PostgREST loads) and two admins removing each other
// at the same moment.

const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as { API_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string };

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient<Database>(status.API_URL, status.SECRET_KEY, noSession);
const anonClient = () => createClient<Database>(status.API_URL, status.PUBLISHABLE_KEY, noSession);

const runId = String(Date.now()).slice(-6);
const phones: string[] = [];
function newPhone() {
  const phone = `+96479${runId}${String(phones.length).padStart(2, "0")}`;
  phones.push(phone);
  return phone;
}

/** A signed-in account with this role, made directly. */
async function signedIn(role: "customer" | "admin") {
  const phone = newPhone();
  const password = randomBytes(32).toString("base64url");
  const { data, error } = await service.auth.admin.createUser({
    phone,
    phone_confirm: true,
    password,
  });
  expect(error).toBeNull();
  const id = data.user!.id;
  if (role !== "customer") {
    await service.from("profiles").update({ role, full_name: "مشرف" }).eq("id", id).throwOnError();
  }
  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ phone, password });
  expect(signInError).toBeNull();
  return { id, phone, client };
}

/** Logs in by phone code, as Login and OTP do; returns the role it lands with. */
async function logIn(phone: string) {
  let sent = "";
  const sender: OtpSender = {
    async send(_phone: string, code: string): Promise<SendResult> {
      sent = code;
      return { ok: true, providerMessageId: "fake" };
    },
  };
  const otp = createOtpService({
    admin: service,
    senders: { whatsapp: sender, sms: sender },
    hmacSecret: status.SECRET_KEY,
    signIn: (p, password) => anonClient().auth.signInWithPassword({ phone: p, password }),
  });
  const request = await otp.requestOtp({ phone, channel: "whatsapp" });
  expect(request.ok).toBe(true);
  return otp.verifyOtp({ phone, code: sent });
}

let admin: Awaited<ReturnType<typeof signedIn>>;
let customer: Awaited<ReturnType<typeof signedIn>>;

beforeAll(async () => {
  [admin, customer] = await Promise.all([signedIn("admin"), signedIn("customer")]);
});

afterAll(async () => {
  const { data } = await service.from("profiles").select("id").in("phone", phones);
  const ids = (data ?? []).map((p) => p.id);
  await service.from("crews").delete().in("user_id", ids);
  await service.from("admin_audit_log").delete().in("admin_id", ids);
  for (const id of ids) await service.auth.admin.deleteUser(id);
});

describe("crews (A10)", () => {
  let crewId: string;
  const crewName = `فريق ${runId}`;
  let crewPhone: string;

  it("creates a crew from a new phone, which then logs in as the crew", async () => {
    crewPhone = newPhone();
    expect(await ensureAccount(crewPhone, service)).toBe(true);
    const { data, error } = await admin.client.rpc("admin_create_crew", {
      p_phone: crewPhone,
      p_name: crewName,
    });
    expect(error).toBeNull();
    crewId = data!;

    const login = await logIn(crewPhone);
    expect(login).toMatchObject({ ok: true, role: "crew" });
  });

  it("refuses a phone that already has a customer account", async () => {
    expect(await ensureAccount(customer.phone, service)).toBe(true);
    const { error } = await admin.client.rpc("admin_create_crew", {
      p_phone: customer.phone,
      p_name: `فريق ${runId}ب`,
    });
    expect(error?.code).toBe("ZL019");
  });

  it("switches a crew off and moves it to a new phone over the API", async () => {
    const { data: open, error } = await admin.client.rpc("admin_update_crew", {
      p_crew_id: crewId,
      p_name: crewName,
      p_active: false,
    });
    expect(error).toBeNull();
    expect(open).toBe(0);

    const next = newPhone();
    expect(await ensureAccount(next, service)).toBe(true);
    const moved = await admin.client.rpc("admin_set_crew_phone", {
      p_crew_id: crewId,
      p_phone: next,
    });
    expect(moved.error).toBeNull();

    const { data: old } = await service
      .from("profiles")
      .select("role")
      .eq("phone", crewPhone)
      .single();
    expect(old?.role).toBe("customer");
  });

  it("refuses a customer's session", async () => {
    const { error } = await customer.client.rpc("admin_update_crew", {
      p_crew_id: crewId,
      p_name: crewName,
      p_active: true,
    });
    expect(error?.code).toBe("42501");
  });
});

describe("admins (A14)", () => {
  it("adds an admin by a new phone, who then logs in as an admin", async () => {
    const phone = newPhone();
    expect(await ensureAccount(phone, service)).toBe(true);
    const { data, error } = await admin.client.rpc("admin_add_admin", {
      p_phone: phone,
      p_name: "مشرف جديد",
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
    expect(await logIn(phone)).toMatchObject({ ok: true, role: "admin" });
  });

  it("lets only one of two admins removing each other at once go through", async () => {
    const [a, b] = await Promise.all([signedIn("admin"), signedIn("admin")]);
    const results = await Promise.all([
      a.client.rpc("admin_remove_admin", { p_user_id: b.id }),
      b.client.rpc("admin_remove_admin", { p_user_id: a.id }),
    ]);
    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect(results.find((r) => r.error !== null)?.error?.code).toBe("42501");

    const { data } = await service.from("profiles").select("role").in("id", [a.id, b.id]);
    expect(data?.map((p) => p.role).sort()).toEqual(["admin", "customer"]);
  });

  it("refuses removing yourself", async () => {
    const { error } = await admin.client.rpc("admin_remove_admin", { p_user_id: admin.id });
    expect(error?.code).toBe("ZL022");
  });
});
