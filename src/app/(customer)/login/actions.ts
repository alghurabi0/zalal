"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { afterLogin } from "@/lib/auth/destination";
import { readPendingLogin, writePendingLogin } from "@/lib/auth/pending-login";
import { requestOtp, verifyOtp } from "@/lib/otp";
import type { ResendState, SendCodeState, VerifyState } from "@/lib/otp/form-states";
import { sendError } from "@/lib/otp/send-error";
import { otpChannelSchema } from "@/lib/otp/schemas";
import { phoneInputSchema } from "@/lib/phone";
import { routes, safeNext } from "@/lib/routes";
import { createAdminClient } from "@/lib/supabase/admin";

// Login (spec §5.2) and OTP (§5.3). The OTP library applies every limit
// in Postgres; these actions only translate its results for the screens.

const sendCodeFormSchema = z.object({
  phone: phoneInputSchema,
  channel: otpChannelSchema,
  next: z.string().max(512).optional(),
});

async function send(phone: string, channel: "whatsapp" | "sms", next: string | null) {
  const result = await requestOtp({ phone, channel });
  if (result.ok) {
    const pending = {
      phone,
      channel: result.channelUsed,
      sentAt: Date.now(),
      smsEnabled: result.smsEnabled,
      next,
    };
    await writePendingLogin(pending);
    return { ok: true as const, pending };
  }
  return { ok: false as const, error: sendError(result, channel) };
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

/** OTP's "أعد الإرسال" and "أرسل برسالة SMS", for the number being verified. */
export async function resendCode(_prev: ResendState, form: FormData): Promise<ResendState> {
  const pending = await readPendingLogin();
  if (!pending) redirect(routes.login);
  const channel = otpChannelSchema.safeParse(form.get("channel"));
  if (!channel.success) return { error: { kind: "send_failed" } };

  const outcome = await send(pending.phone, channel.data, pending.next);
  if (!outcome.ok) return { error: outcome.error.error };
  return { error: null, sentAt: outcome.pending.sentAt, channel: outcome.pending.channel };
}

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

  // The pending-login cookie stays until it expires (15 min) or logout
  // clears it: deleting it here would make Next re-render this page, which
  // then finds no login in progress and redirects to Login, racing the
  // client's navigation to `destination`. A logged-in user can't open
  // /login/* anyway (proxy.ts).
  return {
    status: "ok",
    userId: result.userId,
    destination: afterLogin({
      role: result.role,
      isNewUser: result.isNewUser,
      hasAddress: result.role === "customer" ? await hasAddress(result.userId) : true,
      next: pending.next,
    }),
  };
}

/**
 * Only customers have addresses. The user id comes from a correct code, so
 * the secret-key client only answers "does this user have an address?".
 */
async function hasAddress(userId: string): Promise<boolean> {
  const { count, error } = await createAdminClient()
    .from("addresses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) throw new Error(`Address count failed: ${error.message}`);
  return (count ?? 0) > 0;
}
