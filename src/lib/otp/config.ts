import "server-only";

import * as Sentry from "@sentry/nextjs";

import { otpEnv } from "@/lib/env.server";
import { otpiqSender, type OtpiqAccountProblem } from "@/lib/otp/otpiq";
import { logSender, type OtpSenders } from "@/lib/otp/senders";

/** Tells the owner through Sentry. Only the channel, status and kind: no phone, no code. */
function reportAccountProblem(problem: OtpiqAccountProblem) {
  Sentry.captureMessage(`OTPIQ account problem: ${problem.kind}`, {
    level: "error",
    tags: { otp_channel: problem.channel, otpiq_status: String(problem.status) },
  });
}

/**
 * The senders for this deploy: OTPIQ when a key is set, otherwise the log
 * sender (local dev and CI only; otpEnv refuses a missing key on Vercel).
 */
export function otpSenders(): OtpSenders {
  const env = otpEnv();
  if (env.OTPIQ_API_KEY === undefined) {
    return { whatsapp: logSender("whatsapp"), sms: logSender("sms") };
  }

  const whatsapp =
    env.OTPIQ_WHATSAPP_ACCOUNT_ID && env.OTPIQ_WHATSAPP_PHONE_ID && env.OTPIQ_WHATSAPP_TEMPLATE
      ? {
          accountId: env.OTPIQ_WHATSAPP_ACCOUNT_ID,
          phoneId: env.OTPIQ_WHATSAPP_PHONE_ID,
          templateName: env.OTPIQ_WHATSAPP_TEMPLATE,
        }
      : undefined;
  const config = {
    apiKey: env.OTPIQ_API_KEY,
    smsSenderId: env.OTPIQ_SMS_SENDER_ID,
    whatsapp,
    onAccountProblem: reportAccountProblem,
  };
  return { whatsapp: otpiqSender("whatsapp", config), sms: otpiqSender("sms", config) };
}
