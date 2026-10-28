"use server";

import { redirect } from "next/navigation";

import {
  clearPhoneChange,
  PHONE_CHANGE_TTL_MS,
  type PhoneChange,
  readPhoneChange,
  writePhoneChange,
} from "@/lib/auth/phone-change";
import { requireViewer } from "@/lib/auth/viewer";
import { changePhone, newPhoneAvailable, requestOtp, verifyCurrentPhone } from "@/lib/otp";
import type { CodeFailure } from "@/lib/otp";
import type { ResendState, SendCodeState, VerifyState } from "@/lib/otp/form-states";
import { otpChannelSchema } from "@/lib/otp/schemas";
import { sendError } from "@/lib/otp/send-error";
import { normalizeIraqiMobile } from "@/lib/phone";
import { routes } from "@/lib/routes";

// Phone change (N10, spec §9.1; settled Oct 28, 2026). Two codes: one to the
// account's current number, then one to the new number. Only then does
// change_login_phone move the account, so a stolen session can't move it to
// another number. The steps live in a signed cookie (lib/auth/phone-change).

async function send(
  change: Omit<PhoneChange, "channel" | "sentAt" | "smsEnabled">,
  phone: string,
  channel: "whatsapp" | "sms",
): Promise<{ ok: true; change: PhoneChange } | { ok: false; state: SendCodeState }> {
  const result = await requestOtp({ phone, channel });
  if (!result.ok) return { ok: false, state: sendError(result, channel) };
  const next: PhoneChange = {
    ...change,
    phone,
    channel: result.channelUsed,
    sentAt: Date.now(),
    smsEnabled: result.smsEnabled,
  };
  await writePhoneChange(next);
  return { ok: true, change: next };
}

/** Step 1, "أرسل الرمز": a code to the account's current number. */
export async function startPhoneChange(
  _prev: SendCodeState,
  form: FormData,
): Promise<SendCodeState> {
  const viewer = await requireViewer(routes.changePhone);
  const channel = otpChannelSchema.safeParse(form.get("channel"));
  if (!channel.success) return { error: { kind: "send_failed" } };

  const outcome = await send(
    {
      userId: viewer.id,
      step: "current",
      phone: null,
      expiresAt: Date.now() + PHONE_CHANGE_TTL_MS,
    },
    viewer.phone,
    channel.data,
  );
  if (!outcome.ok) return outcome.state;
  redirect(routes.changePhoneVerify);
}

/** Step 2, "أرسل الرمز": a code to the new number, once the current one is proved. */
export async function sendNewPhoneCode(
  _prev: SendCodeState,
  form: FormData,
): Promise<SendCodeState> {
  const viewer = await requireViewer(routes.changePhone);
  const change = await readPhoneChange(viewer.id);
  if (change?.step !== "new") redirect(routes.changePhone);
  const channel = otpChannelSchema.safeParse(form.get("channel"));
  if (!channel.success) return { error: { kind: "send_failed" } };

  const available = await newPhoneAvailable(viewer.id, form.get("phone"));
  if (!available.ok) {
    if (available.reason === "invalid_input") return { error: { kind: "invalid_phone" } };
    return { error: { kind: available.reason } };
  }
  const phone = normalizeIraqiMobile(String(form.get("phone")));
  if (!phone) return { error: { kind: "invalid_phone" } };
  const outcome = await send(change, phone, channel.data);
  if (!outcome.ok) return outcome.state;
  redirect(routes.changePhoneVerify);
}

/** OTP's "أعد الإرسال" and "أرسل برسالة SMS", for the number being proved. */
export async function resendPhoneChangeCode(
  _prev: ResendState,
  form: FormData,
): Promise<ResendState> {
  const viewer = await requireViewer(routes.changePhone);
  const change = await readPhoneChange(viewer.id);
  if (!change?.phone) redirect(routes.changePhone);
  const channel = otpChannelSchema.safeParse(form.get("channel"));
  if (!channel.success) return { error: { kind: "send_failed" } };

  const outcome = await send(change, change.phone, channel.data);
  if (!outcome.ok) return { error: outcome.state.error };
  return { error: null, sentAt: outcome.change.sentAt, channel: outcome.change.channel };
}

function failed(result: CodeFailure): VerifyState {
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
  }
}

/** OTP's "تحقق وكمّل": proves the current number, then the new one moves the account. */
export async function verifyPhoneChangeCode(
  _prev: VerifyState,
  form: FormData,
): Promise<VerifyState> {
  const viewer = await requireViewer(routes.changePhone);
  const change = await readPhoneChange(viewer.id);
  if (!change?.phone) redirect(routes.changePhone);
  const code = form.get("code");

  if (change.step === "current") {
    // The code must be for the account's number now, not one in a stale cookie.
    if (change.phone !== viewer.phone) redirect(routes.changePhone);
    const result = await verifyCurrentPhone({ phone: change.phone, code });
    if (!result.ok) return failed(result);
    await writePhoneChange({ ...change, step: "new", phone: null, sentAt: 0 });
    return { status: "ok", destination: routes.changePhone };
  }

  const result = await changePhone(viewer.id, { phone: change.phone, code });
  if (!result.ok) {
    switch (result.reason) {
      case "phone_taken":
      case "same_phone":
        return { status: "phone_taken" };
      case "account_unavailable":
        return { status: "account_unavailable" };
      default:
        return failed(result);
    }
  }
  await clearPhoneChange();
  return { status: "ok", destination: `${routes.editProfile}?phone=changed` };
}
