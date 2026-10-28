import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/lib/database.types";
import { hashOtpCode, signInPassword } from "@/lib/otp/code";
import type { OtpSender, SendResult } from "@/lib/otp/senders";
import { createOtpService, type OtpDeps } from "@/lib/otp/service";

vi.mock("server-only", () => ({}));

// The real database is covered by tests/integration/otp-login.test.ts and
// the pgTAP tests; this fake checks how the service reads their answers.

type Profile = {
  id: string;
  role: "customer" | "crew" | "admin";
  full_name: string | null;
  deleted_at: string | null;
};

function fakeAdmin(opts: {
  smsEnabled?: boolean;
  requestRow?: Record<string, unknown>;
  checkRow?: Record<string, unknown>;
  profile?: Profile | null;
  rpcErrors?: Record<string, { code?: string; message: string }>;
}) {
  type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
  const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<RpcResult>>(
    async (name) => {
      const rpcError = opts.rpcErrors?.[name];
      if (rpcError) return { data: null, error: rpcError };
      if (name === "request_otp") {
        return {
          data: opts.requestRow ?? {
            allowed: true,
            reason: null,
            retry_after_s: null,
            request_id: 7,
          },
          error: null,
        };
      }
      if (name === "check_otp") {
        return {
          data: opts.checkRow ?? { result: "ok", attempts_left: null, locked_until: null },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  );
  const createUser = vi.fn(async (attrs: { id: string }) => ({
    data: { user: { id: attrs.id } },
    error: null,
  }));
  const updateUserById = vi.fn(async () => ({ data: { user: {} }, error: null }));
  const from = vi.fn((table: string) => ({
    select: () => ({
      single: async () => ({ data: { sms_enabled: opts.smsEnabled ?? true }, error: null }),
      eq: (_column: string, value: string) => ({
        maybeSingle: async () => ({ data: opts.profile ?? null, error: null, table, value }),
      }),
    }),
  }));
  const admin = { rpc, from, auth: { admin: { createUser, updateUserById } } };
  return {
    admin: admin as unknown as SupabaseClient<Database>,
    rpc,
    from,
    createUser,
    updateUserById,
  };
}

function sender(result: SendResult) {
  return { send: vi.fn<OtpSender["send"]>(async () => result) };
}

function service(admin: SupabaseClient<Database>, overrides: Partial<OtpDeps> = {}) {
  const signIn = vi.fn<OtpDeps["signIn"]>(async () => ({ error: null }));
  const whatsapp = sender({ ok: true, providerMessageId: "wa-1" });
  const sms = sender({ ok: true, providerMessageId: "sms-1" });
  const deps: OtpDeps = {
    admin,
    senders: { whatsapp, sms },
    hmacSecret: "secret",
    signIn,
    ...overrides,
  };
  return { ...createOtpService(deps), signIn, whatsapp, sms };
}

describe("requestOtp", () => {
  it("refuses an invalid number before touching the database", async () => {
    const db = fakeAdmin({});
    const result = await service(db.admin).requestOtp({ phone: "0720", channel: "whatsapp" });
    expect(result).toEqual({ ok: false, reason: "invalid_input" });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("stores only the hash of the code it sends, then records the send", async () => {
    const db = fakeAdmin({});
    const svc = service(db.admin);
    const result = await svc.requestOtp({ phone: "07801234567", channel: "whatsapp" });

    expect(result).toEqual({ ok: true, channelUsed: "whatsapp", smsEnabled: true });
    const code = svc.whatsapp.send.mock.calls[0]?.[1];
    expect(code).toMatch(/^\d{6}$/);
    expect(db.rpc).toHaveBeenCalledWith("request_otp", {
      p_phone: "+9647801234567",
      p_channel: "whatsapp",
      p_code_hash: hashOtpCode("secret", "+9647801234567", code!),
    });
    expect(JSON.stringify(db.rpc.mock.calls)).not.toContain(`"${code}"`);
    expect(db.rpc).toHaveBeenCalledWith("record_otp_sent", {
      p_request_id: 7,
      p_channel_used: "whatsapp",
      p_provider_message_id: "wa-1",
    });
  });

  it("records the SMS fallback", async () => {
    const db = fakeAdmin({});
    const svc = service(db.admin, {
      senders: {
        whatsapp: sender({ ok: false, error: "unavailable" }),
        sms: sender({ ok: true, providerMessageId: null }),
      },
    });
    expect(await svc.requestOtp({ phone: "07801234567", channel: "whatsapp" })).toEqual({
      ok: true,
      channelUsed: "sms",
      smsEnabled: true,
    });
    expect(db.rpc).toHaveBeenCalledWith("record_otp_sent", {
      p_request_id: 7,
      p_channel_used: "sms",
      p_provider_message_id: undefined,
    });
  });

  it("passes on a refusal from the limits without sending", async () => {
    const db = fakeAdmin({
      requestRow: { allowed: false, reason: "too_many", retry_after_s: 120, request_id: null },
    });
    const svc = service(db.admin);
    expect(await svc.requestOtp({ phone: "07801234567", channel: "whatsapp" })).toEqual({
      ok: false,
      reason: "too_many",
      retryAfterS: 120,
      smsEnabled: true,
    });
    expect(svc.whatsapp.send).not.toHaveBeenCalled();
  });

  it("records a failed send and says whether SMS is worth offering", async () => {
    const db = fakeAdmin({ smsEnabled: false });
    const svc = service(db.admin, {
      senders: {
        whatsapp: sender({ ok: false, error: "unavailable" }),
        sms: sender({ ok: true, providerMessageId: null }),
      },
    });
    expect(await svc.requestOtp({ phone: "07801234567", channel: "whatsapp" })).toEqual({
      ok: false,
      reason: "send_failed",
      error: "unavailable",
      canTrySms: false,
      smsEnabled: false,
    });
    expect(db.rpc).toHaveBeenCalledWith("record_otp_send_failed", {
      p_request_id: 7,
      p_error: "unavailable",
    });
  });

  it("offers SMS when WhatsApp failed in a way the fallback skipped", async () => {
    const db = fakeAdmin({});
    const svc = service(db.admin, {
      senders: {
        whatsapp: sender({ ok: false, error: "rate_limited" }),
        sms: sender({ ok: true, providerMessageId: null }),
      },
    });
    const result = await svc.requestOtp({ phone: "07801234567", channel: "whatsapp" });
    expect(result).toMatchObject({ ok: false, reason: "send_failed", canTrySms: true });
  });

  it("throws on a database error, without the phone in the message", async () => {
    const db = fakeAdmin({});
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(
      service(db.admin).requestOtp({ phone: "07801234567", channel: "whatsapp" }),
    ).rejects.toThrow(/^OTP request failed: boom$/);
  });
});

describe("verifyOtp", () => {
  const input = { phone: "07801234567", code: "123456" };

  it("refuses a malformed code before touching the database", async () => {
    const db = fakeAdmin({});
    expect(await service(db.admin).verifyOtp({ ...input, code: "12" })).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("checks the hash of the typed code", async () => {
    const db = fakeAdmin({
      checkRow: { result: "wrong_code", attempts_left: 3, locked_until: null },
    });
    expect(await service(db.admin).verifyOtp(input)).toEqual({
      ok: false,
      reason: "wrong_code",
      attemptsLeft: 3,
    });
    expect(db.rpc).toHaveBeenCalledWith("check_otp", {
      p_phone: "+9647801234567",
      p_code_hash: hashOtpCode("secret", "+9647801234567", "123456"),
    });
  });

  it("turns a lock into seconds to wait", async () => {
    const until = new Date(Date.now() + 15 * 60_000).toISOString();
    const db = fakeAdmin({ checkRow: { result: "locked", attempts_left: 0, locked_until: until } });
    const result = await service(db.admin).verifyOtp(input);
    expect(result).toMatchObject({ ok: false, reason: "locked" });
    expect((result as { retryAfterS: number }).retryAfterS).toBeGreaterThan(890);
    expect((result as { retryAfterS: number }).retryAfterS).toBeLessThanOrEqual(900);
  });

  it.each(["expired", "no_code"])("passes on %s without signing in", async (outcome) => {
    const db = fakeAdmin({
      checkRow: { result: outcome, attempts_left: null, locked_until: null },
    });
    const svc = service(db.admin);
    expect(await svc.verifyOtp(input)).toEqual({ ok: false, reason: outcome });
    expect(svc.signIn).not.toHaveBeenCalled();
  });

  it("creates a new user, confirmed, with the derived password, and signs in", async () => {
    const db = fakeAdmin({ profile: null });
    const svc = service(db.admin);
    const result = await svc.verifyOtp(input);
    expect(result).toMatchObject({ ok: true, isNewUser: true, role: "customer" });
    const created = (db.createUser.mock.calls[0] as unknown[])[0] as {
      id: string;
      phone: string;
      phone_confirm: boolean;
      password: string;
    };
    expect(created).toMatchObject({ phone: "+9647801234567", phone_confirm: true });
    expect((result as { userId: string }).userId).toBe(created.id);
    expect(created.password).toBe(signInPassword("secret", created.id));
    expect(svc.signIn).toHaveBeenCalledWith("+9647801234567", created.password);
  });

  it("signs a returning user in without touching their password", async () => {
    const db = fakeAdmin({
      profile: { id: "u1", role: "admin", full_name: "Zaid", deleted_at: null },
    });
    const svc = service(db.admin);
    expect(await svc.verifyOtp(input)).toEqual({
      ok: true,
      userId: "u1",
      isNewUser: false,
      role: "admin",
    });
    expect(db.createUser).not.toHaveBeenCalled();
    expect(db.updateUserById).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalledWith("set_login_password", expect.anything());
    expect(svc.signIn).toHaveBeenCalledWith("+9647801234567", signInPassword("secret", "u1"));
  });

  it("sets the password once when a user has none yet (seeded or made by an admin)", async () => {
    const db = fakeAdmin({
      profile: { id: "u1", role: "admin", full_name: "Zaid", deleted_at: null },
    });
    const signIn = vi
      .fn<OtpDeps["signIn"]>()
      .mockResolvedValueOnce({ error: { code: "invalid_credentials" } })
      .mockResolvedValueOnce({ error: null });
    const svc = service(db.admin, { signIn });
    expect(await svc.verifyOtp(input)).toMatchObject({ ok: true, userId: "u1" });
    // Through the guarded RPC, never the Auth admin API (migration auth_user_guard).
    expect(db.rpc).toHaveBeenCalledWith("set_login_password", {
      p_user_id: "u1",
      p_password: signInPassword("secret", "u1"),
    });
    expect(db.updateUserById).not.toHaveBeenCalled();
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it("throws when the password can't be set", async () => {
    const db = fakeAdmin({
      profile: { id: "u1", role: "admin", full_name: "Zaid", deleted_at: null },
    });
    db.rpc.mockImplementation(async (name) =>
      name === "set_login_password"
        ? { data: null, error: { message: "boom" } }
        : { data: { result: "ok", attempts_left: null, locked_until: null }, error: null },
    );
    const svc = service(db.admin, {
      signIn: async () => ({ error: { code: "invalid_credentials" } }),
    });
    await expect(svc.verifyOtp(input)).rejects.toThrow(/password set failed: boom/);
  });

  it("throws when sign-in fails for another reason", async () => {
    const db = fakeAdmin({
      profile: { id: "u1", role: "customer", full_name: "A", deleted_at: null },
    });
    const svc = service(db.admin, {
      signIn: async () => ({ error: { code: "unexpected_failure" } }),
    });
    await expect(svc.verifyOtp(input)).rejects.toThrow(/sign-in failed: unexpected_failure/);
    expect(db.updateUserById).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalledWith("set_login_password", expect.anything());
  });

  it("still treats a user without a name as new", async () => {
    const db = fakeAdmin({
      profile: { id: "u1", role: "customer", full_name: null, deleted_at: null },
    });
    expect(await service(db.admin).verifyOtp(input)).toMatchObject({ ok: true, isNewUser: true });
  });

  it("refuses a deleted account", async () => {
    const db = fakeAdmin({
      profile: { id: "u1", role: "customer", full_name: null, deleted_at: "2026-10-01T00:00:00Z" },
    });
    const svc = service(db.admin);
    expect(await svc.verifyOtp(input)).toEqual({ ok: false, reason: "account_unavailable" });
    expect(db.updateUserById).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalledWith("set_login_password", expect.anything());
    expect(svc.signIn).not.toHaveBeenCalled();
  });

  it("refuses a banned account", async () => {
    const db = fakeAdmin({
      profile: { id: "u1", role: "crew", full_name: "Crew 1", deleted_at: null },
    });
    const svc = service(db.admin, {
      signIn: async () => ({ error: { code: "user_banned" } }),
    });
    expect(await svc.verifyOtp(input)).toEqual({ ok: false, reason: "account_unavailable" });
  });
});

describe("phone change", () => {
  const current = { phone: "07801234567", code: "123456" };
  const next = { phone: "07709876543", code: "654321" };

  it("checks the current number's code without signing in", async () => {
    const db = fakeAdmin({});
    const svc = service(db.admin);
    expect(await svc.verifyCurrentPhone(current)).toEqual({ ok: true });
    expect(db.rpc).toHaveBeenCalledWith("check_otp", {
      p_phone: "+9647801234567",
      p_code_hash: hashOtpCode("secret", "+9647801234567", "123456"),
    });
    expect(svc.signIn).not.toHaveBeenCalled();
  });

  it("passes on a wrong code for the current number", async () => {
    const db = fakeAdmin({
      checkRow: { result: "wrong_code", attempts_left: 2, locked_until: null },
    });
    expect(await service(db.admin).verifyCurrentPhone(current)).toEqual({
      ok: false,
      reason: "wrong_code",
      attemptsLeft: 2,
    });
  });

  it("says whether a new number is free", async () => {
    expect(await service(fakeAdmin({}).admin).newPhoneAvailable("u1", "07709876543")).toEqual({
      ok: true,
    });
    const taken = fakeAdmin({
      profile: { id: "u2", role: "customer", full_name: "B", deleted_at: null },
    });
    expect(await service(taken.admin).newPhoneAvailable("u1", "07709876543")).toEqual({
      ok: false,
      reason: "phone_taken",
    });
    const own = fakeAdmin({
      profile: { id: "u1", role: "customer", full_name: "A", deleted_at: null },
    });
    expect(await service(own.admin).newPhoneAvailable("u1", "07709876543")).toEqual({
      ok: false,
      reason: "same_phone",
    });
    expect(await service(own.admin).newPhoneAvailable("u1", "0770")).toEqual({
      ok: false,
      reason: "invalid_input",
    });
  });

  it("moves the account after the new number's code, without signing in", async () => {
    const db = fakeAdmin({});
    const svc = service(db.admin);
    expect(await svc.changePhone("u1", next)).toEqual({ ok: true });
    expect(db.rpc).toHaveBeenCalledWith("change_login_phone", {
      p_user_id: "u1",
      p_phone: "+9647709876543",
    });
    expect(svc.signIn).not.toHaveBeenCalled();
  });

  it("doesn't move the account on a wrong code", async () => {
    const db = fakeAdmin({
      checkRow: { result: "expired", attempts_left: null, locked_until: null },
    });
    expect(await service(db.admin).changePhone("u1", next)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(db.rpc).not.toHaveBeenCalledWith("change_login_phone", expect.anything());
  });

  it.each([
    [{ code: "ZL040", message: "phone_taken" }, "phone_taken"],
    [{ code: "22023", message: "same_phone" }, "same_phone"],
    [{ code: "P0002", message: "account_not_found" }, "account_unavailable"],
    [{ code: "42501", message: "not_allowed" }, "account_unavailable"],
  ])("maps %o to %s", async (error, reason) => {
    const db = fakeAdmin({ rpcErrors: { change_login_phone: error } });
    expect(await service(db.admin).changePhone("u1", next)).toEqual({ ok: false, reason });
  });

  it("throws on another database error", async () => {
    const db = fakeAdmin({ rpcErrors: { change_login_phone: { message: "boom" } } });
    await expect(service(db.admin).changePhone("u1", next)).rejects.toThrow(
      "OTP phone change failed: boom",
    );
  });
});
