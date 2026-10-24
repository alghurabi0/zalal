import { execFileSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "@/lib/database.types";
import type { OtpSender, OtpSenders, SendResult } from "@/lib/otp/senders";
import { createOtpService } from "@/lib/otp/service";

vi.mock("server-only", () => ({}));

// Login by phone end to end against local Supabase (spec §9.1): the real
// request_otp / check_otp functions, the Auth admin API and password
// sign-in. Only delivery is faked: the sender keeps the last code it got.

const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as { API_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string };

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient<Database>(status.API_URL, status.SECRET_KEY, noSession);
const anonClient = () => createClient<Database>(status.API_URL, status.PUBLISHABLE_KEY, noSession);

// Numbers unique to this run, so reruns and other tests don't collide.
const runId = String(Date.now()).slice(-6);
const phones: string[] = [];
function newPhone() {
  const phone = `+96478${runId}${String(phones.length).padStart(2, "0")}`;
  phones.push(phone);
  return phone;
}
const local = (phone: string) => `0${phone.slice(4)}`;

class FakeSender implements OtpSender {
  codes = new Map<string, string>();
  constructor(public result: SendResult = { ok: true, providerMessageId: "fake" }) {}
  async send(phone: string, code: string) {
    if (this.result.ok) this.codes.set(phone, code);
    return this.result;
  }
}

function setup() {
  const whatsapp = new FakeSender();
  const sms = new FakeSender();
  const senders: OtpSenders = { whatsapp, sms };
  // Each sign-in gets its own client, like each browser does.
  const sessions: SupabaseClient<Database>[] = [];
  const service = createOtpService({
    admin,
    senders,
    hmacSecret: status.SECRET_KEY,
    async signIn(phone, password) {
      const client = anonClient();
      sessions.push(client);
      return client.auth.signInWithPassword({ phone, password });
    },
  });
  return { ...service, whatsapp, sms, sessions };
}

/** Moves the phone's sends back in time, past the 45 s resend wait. */
async function skipResendWait(phone: string) {
  const { error } = await admin
    .from("otp_requests")
    .update({ created_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("phone", phone);
  expect(error).toBeNull();
}

async function lastRequest(phone: string) {
  const { data, error } = await admin
    .from("otp_requests")
    .select("*")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .single();
  expect(error).toBeNull();
  return data!;
}

beforeAll(async () => {
  await admin.from("settings").update({ sms_enabled: true }).eq("id", true);
});

afterAll(async () => {
  await admin.from("settings").update({ sms_enabled: true }).eq("id", true);
  const { data } = await admin.from("profiles").select("id").in("phone", phones);
  for (const { id } of data ?? []) await admin.auth.admin.deleteUser(id);
  await admin.from("otp_requests").delete().in("phone", phones);
});

describe("login by phone", () => {
  it("signs up a new user over WhatsApp and gives a working session", async () => {
    const phone = newPhone();
    const otp = setup();

    expect(await otp.requestOtp({ phone: local(phone), channel: "whatsapp" })).toEqual({
      ok: true,
      channelUsed: "whatsapp",
      smsEnabled: true,
    });
    const code = otp.whatsapp.codes.get(phone)!;
    expect(code).toMatch(/^\d{6}$/);

    const row = await lastRequest(phone);
    expect(row).toMatchObject({ channel: "whatsapp", channel_used: "whatsapp", send_error: null });
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.code_hash).not.toContain(code);

    const result = await otp.verifyOtp({ phone: local(phone), code });
    expect(result).toMatchObject({ ok: true, isNewUser: true, role: "customer" });

    const { data: user } = await otp.sessions[0]!.auth.getUser();
    expect(user.user?.phone).toBe(phone.slice(1));
    const { data: profile } = await otp.sessions[0]!.from("profiles").select("id, phone").single();
    expect(profile).toEqual({ id: (result as { userId: string }).userId, phone });

    expect(await otp.verifyOtp({ phone: local(phone), code })).toEqual({
      ok: false,
      reason: "no_code",
    });
  });

  it("signs a returning user in again and keeps their other sessions", async () => {
    const phone = newPhone();
    const otp = setup();

    await otp.requestOtp({ phone: local(phone), channel: "whatsapp" });
    const first = await otp.verifyOtp({
      phone: local(phone),
      code: otp.whatsapp.codes.get(phone)!,
    });
    expect(first.ok).toBe(true);

    await skipResendWait(phone);
    await otp.requestOtp({ phone: local(phone), channel: "whatsapp" });
    const second = await otp.verifyOtp({
      phone: local(phone),
      code: otp.whatsapp.codes.get(phone)!,
    });
    expect(second).toMatchObject({ ok: true, userId: (first as { userId: string }).userId });

    // The first device's session survives the password change.
    const { error } = await otp.sessions[0]!.auth.refreshSession();
    expect(error).toBeNull();
  });

  it("logs in a user created without a password, like the seeded first admin", async () => {
    const phone = newPhone();
    const { data: created, error } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
    });
    expect(error).toBeNull();
    const otp = setup();
    await otp.requestOtp({ phone: local(phone), channel: "whatsapp" });
    const result = await otp.verifyOtp({
      phone: local(phone),
      code: otp.whatsapp.codes.get(phone)!,
    });
    expect(result).toMatchObject({ ok: true, userId: created.user!.id });
  });

  it("refuses a password or an email set through a user's own session", async () => {
    // Someone holding a stolen session must not get a second way in
    // (migration auth_user_guard, spec §13).
    const phone = newPhone();
    const otp = setup();
    await otp.requestOtp({ phone: local(phone), channel: "whatsapp" });
    const login = await otp.verifyOtp({
      phone: local(phone),
      code: otp.whatsapp.codes.get(phone)!,
    });
    expect(login.ok).toBe(true);
    const session = otp.sessions[0]!;

    const setPassword = await session.auth.updateUser({ password: "thief-password-123" });
    expect(setPassword.error).not.toBeNull();
    const thief = await anonClient().auth.signInWithPassword({
      phone,
      password: "thief-password-123",
    });
    expect(thief.error?.code).toBe("invalid_credentials");

    const setEmail = await session.auth.updateUser({ email: "thief@example.com" });
    expect(setEmail.error).not.toBeNull();
    const { data: stored } = await admin.auth.admin.getUserById(
      (login as { userId: string }).userId,
    );
    expect(stored.user?.email ?? "").toBe("");
    expect(stored.user?.new_email ?? "").toBe("");

    // The owner's session still works, and so does the next code login.
    expect((await session.auth.refreshSession()).error).toBeNull();
    await skipResendWait(phone);
    await otp.requestOtp({ phone: local(phone), channel: "whatsapp" });
    expect(
      await otp.verifyOtp({ phone: local(phone), code: otp.whatsapp.codes.get(phone)! }),
    ).toMatchObject({ ok: true });
  });

  it("can still set a new password after the secret key is rotated", async () => {
    const phone = newPhone();
    const before = setup();
    await before.requestOtp({ phone: local(phone), channel: "whatsapp" });
    const first = await before.verifyOtp({
      phone: local(phone),
      code: before.whatsapp.codes.get(phone)!,
    });
    expect(first.ok).toBe(true);

    // A service with another secret derives another password: sign-in fails
    // once, then the server opens a window and sets the new one.
    const whatsapp = new FakeSender();
    const rotated = createOtpService({
      admin,
      senders: { whatsapp, sms: new FakeSender() },
      hmacSecret: "rotated-secret",
      signIn: (p, password) => anonClient().auth.signInWithPassword({ phone: p, password }),
    });
    await skipResendWait(phone);
    await rotated.requestOtp({ phone: local(phone), channel: "whatsapp" });
    expect(
      await rotated.verifyOtp({ phone: local(phone), code: whatsapp.codes.get(phone)! }),
    ).toMatchObject({ ok: true, userId: (first as { userId: string }).userId });
  });

  it("falls back to SMS when WhatsApp fails, and records it", async () => {
    const phone = newPhone();
    const otp = setup();
    otp.whatsapp.result = { ok: false, error: "unavailable" };

    expect(await otp.requestOtp({ phone: local(phone), channel: "whatsapp" })).toMatchObject({
      ok: true,
      channelUsed: "sms",
    });
    expect(await lastRequest(phone)).toMatchObject({ channel: "whatsapp", channel_used: "sms" });
    const result = await otp.verifyOtp({ phone: local(phone), code: otp.sms.codes.get(phone)! });
    expect(result.ok).toBe(true);
  });

  it("records a failed send and lets the user switch to SMS at once", async () => {
    const phone = newPhone();
    const otp = setup();
    otp.whatsapp.result = { ok: false, error: "unavailable" };
    otp.sms.result = { ok: false, error: "unavailable" };

    expect(await otp.requestOtp({ phone: local(phone), channel: "whatsapp" })).toMatchObject({
      ok: false,
      reason: "send_failed",
      error: "unavailable",
    });
    expect(await lastRequest(phone)).toMatchObject({ send_error: "unavailable", sent_at: null });

    otp.sms.result = { ok: true, providerMessageId: null };
    expect(await otp.requestOtp({ phone: local(phone), channel: "sms" })).toMatchObject({
      ok: true,
      channelUsed: "sms",
    });
  });

  it("refuses SMS while the admin switch is off", async () => {
    const phone = newPhone();
    const otp = setup();
    await admin.from("settings").update({ sms_enabled: false }).eq("id", true);
    try {
      expect(await otp.requestOtp({ phone: local(phone), channel: "sms" })).toEqual({
        ok: false,
        reason: "sms_disabled",
        retryAfterS: null,
        smsEnabled: false,
      });
      // And no SMS fallback when WhatsApp fails.
      otp.whatsapp.result = { ok: false, error: "unavailable" };
      expect(await otp.requestOtp({ phone: local(phone), channel: "whatsapp" })).toMatchObject({
        ok: false,
        reason: "send_failed",
        canTrySms: false,
      });
      expect(otp.sms.codes.size).toBe(0);
    } finally {
      await admin.from("settings").update({ sms_enabled: true }).eq("id", true);
    }
  });

  it("locks the phone after 5 wrong codes, even for the right one", async () => {
    const phone = newPhone();
    const otp = setup();
    await otp.requestOtp({ phone: local(phone), channel: "whatsapp" });
    const code = otp.whatsapp.codes.get(phone)!;
    const wrong = code === "000000" ? "111111" : "000000";

    for (const left of [4, 3, 2, 1]) {
      expect(await otp.verifyOtp({ phone: local(phone), code: wrong })).toEqual({
        ok: false,
        reason: "wrong_code",
        attemptsLeft: left,
      });
    }
    expect(await otp.verifyOtp({ phone: local(phone), code: wrong })).toMatchObject({
      ok: false,
      reason: "locked",
    });
    expect(await otp.verifyOtp({ phone: local(phone), code })).toMatchObject({
      ok: false,
      reason: "locked",
    });
    expect(otp.sessions).toHaveLength(0);

    await skipResendWait(phone);
    expect(await otp.requestOtp({ phone: local(phone), channel: "whatsapp" })).toMatchObject({
      ok: false,
      reason: "locked",
    });
  });

  it("enforces the 45 s resend wait", async () => {
    const phone = newPhone();
    const otp = setup();
    await otp.requestOtp({ phone: local(phone), channel: "whatsapp" });
    const again = await otp.requestOtp({ phone: local(phone), channel: "whatsapp" });
    expect(again).toMatchObject({ ok: false, reason: "too_soon" });
    expect((again as { retryAfterS: number }).retryAfterS).toBeGreaterThan(40);
  });
});

describe("Supabase Auth can't be used to get around the server", () => {
  it("sends no code when a client calls /otp directly", async () => {
    const phone = newPhone();
    const { error } = await anonClient().auth.signInWithOtp({ phone });
    expect(error).not.toBeNull();
  });

  it("sends no code to an existing user either", async () => {
    const phone = newPhone();
    const otp = setup();
    await otp.requestOtp({ phone: local(phone), channel: "whatsapp" });
    await otp.verifyOtp({ phone: local(phone), code: otp.whatsapp.codes.get(phone)! });

    const client = anonClient();
    expect((await client.auth.signInWithOtp({ phone })).error).not.toBeNull();
    // Our code was never an Auth code, so Auth's /verify can't use it either.
    await skipResendWait(phone);
    await otp.requestOtp({ phone: local(phone), channel: "whatsapp" });
    const { error } = await client.auth.verifyOtp({
      phone,
      token: otp.whatsapp.codes.get(phone)!,
      type: "sms",
    });
    expect(error).not.toBeNull();
  });

  it("refuses direct phone sign-ups", async () => {
    const phone = newPhone();
    const { error } = await anonClient().auth.signUp({ phone, password: "a-long-password-123" });
    expect(error).not.toBeNull();
    const { data } = await admin.from("profiles").select("id").eq("phone", phone);
    expect(data).toEqual([]);
  });
});
