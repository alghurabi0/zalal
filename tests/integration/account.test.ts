import { execFileSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { Database } from "@/lib/database.types";
import type { OtpSender, OtpSenders } from "@/lib/otp/senders";
import { createOtpService } from "@/lib/otp/service";

vi.mock("server-only", () => ({}));

// Phone change (N10), log out everywhere and account deletion (N13) against
// local Supabase (spec §9.1, §7): the real OTP functions, Auth's sessions and
// the delete_account / change_login_phone RPCs. Delivery is faked.

const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as { API_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string };

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient<Database>(status.API_URL, status.SECRET_KEY, noSession);
const anonClient = () => createClient<Database>(status.API_URL, status.PUBLISHABLE_KEY, noSession);

const runId = String(Date.now()).slice(-6);
const phones: string[] = [];
const userIds = new Set<string>();
function newPhone() {
  const phone = `+96477${runId}${String(phones.length).padStart(2, "0")}`;
  phones.push(phone);
  return phone;
}
const local = (phone: string) => `0${phone.slice(4)}`;

class FakeSender implements OtpSender {
  codes = new Map<string, string>();
  async send(phone: string, code: string) {
    this.codes.set(phone, code);
    return { ok: true as const, providerMessageId: "fake" };
  }
}

function setup() {
  const whatsapp = new FakeSender();
  const senders: OtpSenders = { whatsapp, sms: new FakeSender() };
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
  return { ...service, whatsapp, sessions };
}

/** Logs a new customer in and returns their session and id. */
async function logIn(otp: ReturnType<typeof setup>, phone: string) {
  expect((await otp.requestOtp({ phone: local(phone), channel: "whatsapp" })).ok).toBe(true);
  const result = await otp.verifyOtp({ phone: local(phone), code: otp.whatsapp.codes.get(phone) });
  if (!result.ok) throw new Error(`login failed: ${result.reason}`);
  userIds.add(result.userId);
  return { userId: result.userId, session: otp.sessions.at(-1)! };
}

async function skipResendWait(phone: string) {
  await admin
    .from("otp_requests")
    .update({ created_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("phone", phone);
}

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("otp_requests").delete().in("phone", phones);
});

describe("phone change", () => {
  it("moves the account to the new number, which then logs in to it", async () => {
    const otp = setup();
    const oldPhone = newPhone();
    const nextPhone = newPhone();
    const { userId, session } = await logIn(otp, oldPhone);

    await skipResendWait(oldPhone);
    await otp.requestOtp({ phone: local(oldPhone), channel: "whatsapp" });
    expect(
      await otp.verifyCurrentPhone({
        phone: local(oldPhone),
        code: otp.whatsapp.codes.get(oldPhone),
      }),
    ).toEqual({ ok: true });

    expect(await otp.newPhoneAvailable(userId, local(nextPhone))).toEqual({ ok: true });
    await otp.requestOtp({ phone: local(nextPhone), channel: "whatsapp" });
    expect(
      await otp.changePhone(userId, {
        phone: local(nextPhone),
        code: otp.whatsapp.codes.get(nextPhone),
      }),
    ).toEqual({ ok: true });

    const { data: profile } = await admin
      .from("profiles")
      .select("phone")
      .eq("id", userId)
      .single();
    expect(profile?.phone).toBe(nextPhone);
    // The session the user is in keeps working.
    const { data: user } = await session.auth.getUser();
    expect(user.user?.phone).toBe(nextPhone.slice(1));

    // The new number reaches the same account; the old one is a new signup.
    await skipResendWait(nextPhone);
    expect((await logIn(otp, nextPhone)).userId).toBe(userId);
    await skipResendWait(oldPhone);
    expect((await logIn(otp, oldPhone)).userId).not.toBe(userId);
  });

  it("refuses a number that has an account", async () => {
    const otp = setup();
    const a = newPhone();
    const b = newPhone();
    const { userId } = await logIn(otp, a);
    await logIn(otp, b);

    expect(await otp.newPhoneAvailable(userId, local(b))).toEqual({
      ok: false,
      reason: "phone_taken",
    });
    // Even if a code reached that number, the RPC refuses the move.
    await skipResendWait(b);
    await otp.requestOtp({ phone: local(b), channel: "whatsapp" });
    expect(
      await otp.changePhone(userId, { phone: local(b), code: otp.whatsapp.codes.get(b) }),
    ).toEqual({ ok: false, reason: "phone_taken" });
  });
});

describe("log out everywhere", () => {
  it("ends the user's other sessions and forgets their push subscriptions", async () => {
    const otp = setup();
    const phone = newPhone();
    const first = await logIn(otp, phone);
    await skipResendWait(phone);
    const second = await logIn(otp, phone);

    const { error: saveError } = await second.session.rpc("save_push_subscription", {
      p_endpoint: "https://fcm.googleapis.com/fcm/send/account-test",
      p_p256dh: `B${"a".repeat(86)}`,
      p_auth: "b".repeat(22),
      p_user_agent: "Test",
    });
    expect(saveError).toBeNull();

    expect((await second.session.rpc("delete_my_push_subscriptions")).error).toBeNull();
    expect((await second.session.auth.signOut({ scope: "global" })).error).toBeNull();

    const { count } = await admin
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", first.userId);
    expect(count).toBe(0);
    const { error: refreshError } = await first.session.auth.refreshSession();
    expect(refreshError).not.toBeNull();
  });
});

describe("account deletion", () => {
  it("signs out everywhere, hides everything and frees the phone", async () => {
    const otp = setup();
    const phone = newPhone();
    const { userId, session } = await logIn(otp, phone);
    await session.from("profiles").update({ full_name: "Deleted Soon" }).eq("id", userId);

    const { data: pdfs, error } = await session.rpc("delete_account");
    expect(error).toBeNull();
    expect(pdfs).toEqual([]);

    const { data: profile } = await admin
      .from("profiles")
      .select("phone, full_name, deleted_at")
      .eq("id", userId)
      .single();
    expect(profile).toMatchObject({ phone: null, full_name: null });
    expect(profile?.deleted_at).not.toBeNull();

    // The session's refresh token is gone.
    const { error: refreshError } = await session.auth.refreshSession();
    expect(refreshError).not.toBeNull();

    // The same number signs up again as a brand-new, empty account.
    await skipResendWait(phone);
    expect((await otp.requestOtp({ phone: local(phone), channel: "whatsapp" })).ok).toBe(true);
    const again = await otp.verifyOtp({ phone: local(phone), code: otp.whatsapp.codes.get(phone) });
    expect(again).toMatchObject({ ok: true, isNewUser: true });
    if (again.ok) {
      userIds.add(again.userId);
      expect(again.userId).not.toBe(userId);
    }
  });
});
