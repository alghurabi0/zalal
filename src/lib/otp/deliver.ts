import "server-only";

import type { OtpChannel } from "@/lib/otp/schemas";
import type { OtpSenders, SendError } from "@/lib/otp/senders";

export type DeliveryResult =
  | { ok: true; channelUsed: OtpChannel; providerMessageId: string | null }
  | { ok: false; error: SendError; triedSms: boolean };

// A failure SMS can get around. A provider account problem or the provider's
// per-number limit would fail the same way over SMS.
const SMS_CAN_HELP: ReadonlySet<SendError> = new Set(["unavailable", "rejected", "not_configured"]);

/**
 * Sends the code over the chosen channel (spec §9.1). When WhatsApp fails
 * right away and SMS is on, it retries once over SMS. The SMS channel itself
 * is refused earlier by request_otp while sms_enabled is off.
 */
export async function deliverOtp(params: {
  phone: string;
  code: string;
  channel: OtpChannel;
  smsEnabled: boolean;
  senders: OtpSenders;
}): Promise<DeliveryResult> {
  const { phone, code, channel, smsEnabled, senders } = params;

  const first = await senders[channel].send(phone, code);
  if (first.ok)
    return { ok: true, channelUsed: channel, providerMessageId: first.providerMessageId };

  if (channel === "whatsapp" && smsEnabled && SMS_CAN_HELP.has(first.error)) {
    const retry = await senders.sms.send(phone, code);
    if (retry.ok)
      return { ok: true, channelUsed: "sms", providerMessageId: retry.providerMessageId };
    return { ok: false, error: retry.error, triedSms: true };
  }

  return { ok: false, error: first.error, triedSms: channel === "sms" };
}
