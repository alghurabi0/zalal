import "server-only";

import type { OtpChannel } from "@/lib/otp/schemas";

/**
 * Why a send failed. The same codes are stored in otp_requests.send_error.
 * - unavailable: timeout, network or provider-side error; worth retrying.
 * - rejected: the provider refused this number or request.
 * - provider_account: a problem with our provider account (key, credit,
 *   spending cap, trial mode). The owner has to fix it.
 * - rate_limited: the provider's own per-number limit.
 * - not_configured: no sender is set up for this channel.
 */
export type SendError =
  "unavailable" | "rejected" | "provider_account" | "rate_limited" | "not_configured";

export type SendResult =
  { ok: true; providerMessageId: string | null } | { ok: false; error: SendError };

/**
 * Delivers a code over one channel (spec §9.1). OTPIQ implements it for
 * both WhatsApp and SMS; another SMS provider can be added behind it later.
 * Implementations never throw: every failure comes back as a SendResult.
 */
export interface OtpSender {
  /** `phone` is E.164 (`+9647…`). */
  send(phone: string, code: string): Promise<SendResult>;
}

export type OtpSenders = Record<OtpChannel, OtpSender>;

/**
 * Local development and CI only (no OTPIQ key, not on Vercel): prints the
 * code to the server terminal instead of sending it.
 */
export function logSender(channel: OtpChannel): OtpSender {
  return {
    async send(phone, code) {
      console.info(`[otp] ${channel} code for ${phone}: ${code} (local log sender, nothing sent)`);
      return { ok: true, providerMessageId: null };
    },
  };
}
