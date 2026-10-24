import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/lib/database.types";
import { randomUUID } from "node:crypto";

import { generateOtpCode, hashOtpCode, signInPassword } from "@/lib/otp/code";
import { deliverOtp } from "@/lib/otp/deliver";
import { requestOtpInputSchema, verifyOtpInputSchema, type OtpChannel } from "@/lib/otp/schemas";
import type { OtpSenders, SendError } from "@/lib/otp/senders";

// Login by phone (spec §9.1). Our server makes, sends and checks the code;
// Supabase Auth never sends or checks phone codes (its Send SMS Hook
// refuses every send), so its public /verify endpoint has nothing to guess.
// After a correct code, the server creates the user if needed and signs in
// with the user's server-derived password (signInPassword), which gives a
// normal Supabase session.

export type OtpDeps = {
  /** Secret-key client: calls the server-only OTP functions and the Auth admin API. */
  admin: SupabaseClient<Database>;
  senders: OtpSenders;
  /** Keys the code HMAC. */
  hmacSecret: string;
  /** Signs in as the user and stores the session (cookies in the app). */
  signIn: (phone: string, password: string) => Promise<{ error: { code?: string } | null }>;
};

export type RequestOtpResult =
  | { ok: true; channelUsed: OtpChannel; smsEnabled: boolean }
  | { ok: false; reason: "invalid_input" }
  | {
      ok: false;
      reason: "sms_disabled" | "locked" | "too_soon" | "too_many" | "daily_limit";
      retryAfterS: number | null;
      smsEnabled: boolean;
    }
  | {
      ok: false;
      reason: "send_failed";
      error: SendError;
      /** WhatsApp failed, SMS is on and wasn't tried: Login can offer it. */
      canTrySms: boolean;
      smsEnabled: boolean;
    };

export type VerifyOtpResult =
  | { ok: true; userId: string; isNewUser: boolean; role: Database["public"]["Enums"]["app_role"] }
  | { ok: false; reason: "invalid_input" | "expired" | "no_code" | "account_unavailable" }
  | { ok: false; reason: "wrong_code"; attemptsLeft: number }
  | { ok: false; reason: "locked"; retryAfterS: number };

const requestOtpRowSchema = z.object({
  allowed: z.boolean(),
  reason: z.enum(["sms_disabled", "locked", "too_soon", "too_many", "daily_limit"]).nullable(),
  retry_after_s: z.number().int().nullable(),
  request_id: z.number().int().nullable(),
});

const checkOtpRowSchema = z.object({
  result: z.enum(["ok", "wrong_code", "locked", "expired", "no_code"]),
  attempts_left: z.number().int().nullable(),
  locked_until: z.string().nullable(),
});

// supabase-js returns a function's OUT parameters as one object.
function oneRow<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(Array.isArray(data) ? data[0] : data);
}

function fail(step: string, error: { message: string }): never {
  throw new Error(`OTP ${step} failed: ${error.message}`);
}

async function smsEnabled(admin: OtpDeps["admin"]): Promise<boolean> {
  const { data, error } = await admin.from("settings").select("sms_enabled").single();
  if (error) fail("settings read", error);
  return data.sms_enabled;
}

export function createOtpService(deps: OtpDeps) {
  const { admin } = deps;

  /** Login's send button. Applies the send limits, then delivers the code. */
  async function requestOtp(input: unknown): Promise<RequestOtpResult> {
    const parsed = requestOtpInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: "invalid_input" };
    const { phone, channel } = parsed.data;

    const sms = await smsEnabled(admin);
    const code = generateOtpCode();

    const { data, error } = await admin.rpc("request_otp", {
      p_phone: phone,
      p_channel: channel,
      p_code_hash: hashOtpCode(deps.hmacSecret, phone, code),
    });
    if (error) fail("request", error);
    const row = oneRow(requestOtpRowSchema, data);
    if (!row.allowed || row.request_id === null) {
      return {
        ok: false,
        reason: row.reason ?? "too_soon",
        retryAfterS: row.retry_after_s,
        smsEnabled: sms,
      };
    }

    const delivery = await deliverOtp({
      phone,
      code,
      channel,
      smsEnabled: sms,
      senders: deps.senders,
    });

    if (delivery.ok) {
      const { error: recordError } = await admin.rpc("record_otp_sent", {
        p_request_id: row.request_id,
        p_channel_used: delivery.channelUsed,
        p_provider_message_id: delivery.providerMessageId ?? undefined,
      });
      if (recordError) fail("record sent", recordError);
      return { ok: true, channelUsed: delivery.channelUsed, smsEnabled: sms };
    }

    const { error: recordError } = await admin.rpc("record_otp_send_failed", {
      p_request_id: row.request_id,
      p_error: delivery.error,
    });
    if (recordError) fail("record failure", recordError);
    return {
      ok: false,
      reason: "send_failed",
      error: delivery.error,
      canTrySms: channel === "whatsapp" && sms && !delivery.triedSms,
      smsEnabled: sms,
    };
  }

  /** OTP screen. Checks the code and, when it is right, signs the user in. */
  async function verifyOtp(input: unknown): Promise<VerifyOtpResult> {
    const parsed = verifyOtpInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: "invalid_input" };
    const { phone, code } = parsed.data;

    const { data, error } = await admin.rpc("check_otp", {
      p_phone: phone,
      p_code_hash: hashOtpCode(deps.hmacSecret, phone, code),
    });
    if (error) fail("check", error);
    const check = oneRow(checkOtpRowSchema, data);

    switch (check.result) {
      case "wrong_code":
        return { ok: false, reason: "wrong_code", attemptsLeft: check.attempts_left ?? 0 };
      case "locked": {
        const until = check.locked_until ? Date.parse(check.locked_until) : Date.now();
        return {
          ok: false,
          reason: "locked",
          retryAfterS: Math.max(0, Math.ceil((until - Date.now()) / 1000)),
        };
      }
      case "expired":
      case "no_code":
        return { ok: false, reason: check.result };
      case "ok":
        break;
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, role, full_name, deleted_at")
      .eq("phone", phone)
      .maybeSingle();
    if (profileError) fail("profile read", profileError);

    let userId: string;
    let isNewUser: boolean;
    let role: Database["public"]["Enums"]["app_role"];

    if (profile === null) {
      // The signup trigger creates the profile as a customer.
      userId = randomUUID();
      const { error: createError } = await admin.auth.admin.createUser({
        id: userId,
        phone,
        phone_confirm: true,
        password: signInPassword(deps.hmacSecret, userId),
      });
      if (createError) fail("user create", createError);
      isNewUser = true;
      role = "customer";
    } else {
      if (profile.deleted_at !== null) return { ok: false, reason: "account_unavailable" };
      userId = profile.id;
      // Name (N1) comes right after the first login; until it's saved, the
      // user still counts as new.
      isNewUser = profile.full_name === null;
      role = profile.role;
    }

    const password = signInPassword(deps.hmacSecret, userId);
    let { error: signInError } = await deps.signIn(phone, password);

    // The user has no password yet (created by the seed or an admin) or an
    // old one (the secret was rotated). Setting it signs them out elsewhere,
    // which happens only this once.
    if (signInError?.code === "invalid_credentials" && profile !== null) {
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password });
      if (updateError) fail("password set", updateError);
      ({ error: signInError } = await deps.signIn(phone, password));
    }

    if (signInError) {
      if (signInError.code === "user_banned") return { ok: false, reason: "account_unavailable" };
      fail("sign-in", { message: signInError.code ?? "unknown" });
    }

    return { ok: true, userId, isNewUser, role };
  }

  return { requestOtp, verifyOtp };
}
