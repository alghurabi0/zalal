"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { afterLogin } from "@/lib/auth/destination";
import { clearPendingLogin, readPendingLogin, writePendingLogin } from "@/lib/auth/pending-login";
import { requestOtp, verifyOtp } from "@/lib/otp";
import { otpChannelSchema } from "@/lib/otp/schemas";
import { phoneInputSchema } from "@/lib/phone";
import { routes, safeNext } from "@/lib/routes";
import { createAdminClient } from "@/lib/supabase/admin";

// Login (spec §5.2) and OTP (§5.3). The OTP library applies every limit
// in Postgres; these actions only translate its results for the screens.

/** Why a send didn't happen, for the Login and OTP screens to word. */
export type SendError =
  | { kind: "invalid_phone" }
  | { kind: "wait"; retryAfterS: number }
  | { kind: "locked"; retryAfterS: number }
  | { kind: "sms_disabled" }
  | { kind: "whatsapp_failed"; canTrySms: boolean }
  | { kind: "send_failed" };

export type SendCodeState = { error: SendError | null; smsEnabled?: boolean };

const sendCodeFormSchema = z.object({
  phone: phoneInputSchema,
  channel: otpChannelSchema,
  next: z.string().max(512).optional(),
});

async function send(phone: string, channel: "whatsapp" | "sms", next: string | null) {
  const result = await requestOtp({ phone, channel });
  if (result.ok) {
    await writePendingLogin({
      phone,
      channel: result.channelUsed,
      sentAt: Date.now(),
      smsEnabled: result.smsEnabled,
      next,
    });
    return { ok: true as const };
  }
  return { ok: false as const, error: sendError(result, channel) };
}

function sendError(
  result: Exclude<Awaited<ReturnType<typeof requestOtp>>, { ok: true }>,
  channel: "whatsapp" | "sms",
): SendCodeState {
  switch (result.reason) {
    case "invalid_input":
      return { error: { kind: "invalid_phone" } };
    case "sms_disabled":
      return { error: { kind: "sms_disabled" }, smsEnabled: false };
    case "locked":
      return {
        error: { kind: "locked", retryAfterS: result.retryAfterS ?? 15 * 60 },
        smsEnabled: result.smsEnabled,
      };
    case "too_soon":
    case "too_many":
    case "daily_limit":
      return {
        error: { kind: "wait", retryAfterS: result.retryAfterS ?? 60 },
        smsEnabled: result.smsEnabled,
      };
    case "send_failed":
      return {
        error:
          channel === "whatsapp"
            ? { kind: "whatsapp_failed", canTrySms: result.canTrySms }
            : { kind: "send_failed" },
        smsEnabled: result.smsEnabled,
      };
  }
}

/** Login's "أرسل الرمز". On success, opens the OTP screen. */
export async function sendCode(_prev: SendCodeState, form: FormData): Promise<SendCodeState> {
  const parsed = sendCodeFormSchema.safeParse({
    phone: form.get("phone"),
    channel: form.get("channel"),
    next: form.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: { kind: "invalid_phone" } };

  const { phone, channel } = parsed.data;
  const outcome = await send(phone, channel, safeNext(parsed.data.next));
  if (!outcome.ok) return outcome.error;
  redirect(routes.verify);
}

export type ResendState = {
  error: SendError | null;
  sentAt?: number;
  channel?: "whatsapp" | "sms";
};

/** OTP's "أعد الإرسال" and "أرسل برسالة SMS", for the number being verified. */
export async function resendCode(_prev: ResendState, form: FormData): Promise<ResendState> {
  const pending = await readPendingLogin();
  if (!pending) redirect(routes.login);
  const channel = otpChannelSchema.safeParse(form.get("channel"));
  if (!channel.success) return { error: { kind: "send_failed" } };

  const outcome = await send(pending.phone, channel.data, pending.next);
  if (!outcome.ok) return { error: outcome.error.error };
  const updated = await readPendingLogin();
  return { error: null, sentAt: updated?.sentAt, channel: updated?.channel };
}

export type VerifyState =
  | { status: "idle" }
  | { status: "ok"; userId: string; destination: string }
  | { status: "wrong_code"; attemptsLeft: number }
  | { status: "locked"; retryAfterS: number }
  | { status: "expired" | "account_unavailable" | "invalid_code" };

/** OTP's "تحقق وكمّل" (and the 6th digit). Signs in, then says where to go. */
export async function verifyCode(_prev: VerifyState, form: FormData): Promise<VerifyState> {
  const pending = await readPendingLogin();
  if (!pending) redirect(routes.login);

  const result = await verifyOtp({ phone: pending.phone, code: form.get("code") });
  if (!result.ok) {
    switch (result.reason) {
      case "invalid_input":
        return { status: "invalid_code" };
      case "wrong_code":
        return { status: "wrong_code", attemptsLeft: result.attemptsLeft };
      case "locked":
        return { status: "locked", retryAfterS: result.retryAfterS };
      case "expired":
      case "no_code":
        return { status: "expired" };
      case "account_unavailable":
        return { status: "account_unavailable" };
    }
  }

  // The user id comes from a correct code, so the secret-key client only
  // answers "does this user have an address?".
  const { count, error } = await createAdminClient()
    .from("addresses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", result.userId)
    .is("deleted_at", null);
  if (error) throw new Error(`Address count failed: ${error.message}`);

  await clearPendingLogin();
  return {
    status: "ok",
    userId: result.userId,
    destination: afterLogin({
      role: result.role,
      isNewUser: result.isNewUser,
      hasAddress: (count ?? 0) > 0,
      next: pending.next,
    }),
  };
}
