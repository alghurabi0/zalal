import "server-only";

import { z } from "zod";

import type { OtpChannel } from "@/lib/otp/schemas";
import type { OtpSender, SendError } from "@/lib/otp/senders";

// OTPIQ (https://docs.otpiq.com/api-reference/messaging/post): one endpoint,
// POST /sms, sends a verification code by WhatsApp or SMS. A 200 means OTPIQ
// accepted the task; delivery happens after. Errors:
// - 400: validation, or an account problem (insufficient credit, spending
//   threshold, trial mode, sender ID not accepted);
// - 401: bad API key; 429: OTPIQ's per-number rate limit; 5xx: their side.

export const OTPIQ_API_URL = "https://api.otpiq.com/api";

/** WhatsApp has 5 s, then SMS another 5 s, so a login answers within about 10 s. */
const DEFAULT_TIMEOUT_MS = 5_000;

export type OtpiqConfig = {
  /** `sk_live_…`, or `sk_dev_…`, which sends every message to the dev phone set in OTPIQ. */
  apiKey: string;
  /** A registered SMS sender ID (needs an Iraqi company license). OTPIQ's default otherwise. */
  smsSenderId?: string;
  /** Our own WhatsApp Business number and approved template. OTPIQ's account otherwise. */
  whatsapp?: { accountId: string; phoneId: string; templateName: string };
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Called when the owner has to act (bad key, no credit…). Never gets the phone or code. */
  onAccountProblem?: (problem: OtpiqAccountProblem) => void;
};

export type OtpiqAccountProblem = {
  channel: OtpChannel;
  status: number;
  kind: "unauthorized" | "insufficient_credit" | "spending_threshold" | "trial_mode" | "sender_id";
};

const successSchema = z.object({ smsId: z.string().min(1).max(64) });

const errorBodySchema = z.object({
  error: z.string().optional(),
  yourCredit: z.number().optional(),
  spendingThreshold: z.number().optional(),
});

/** Sorts a 400 into an account problem (owner must act) or a refused request. */
function classifyBadRequest(body: unknown): OtpiqAccountProblem["kind"] | null {
  const parsed = errorBodySchema.safeParse(body);
  if (!parsed.success) return null;
  const { error = "", yourCredit, spendingThreshold } = parsed.data;
  if (yourCredit !== undefined || /insufficient credit/i.test(error)) return "insufficient_credit";
  if (spendingThreshold !== undefined || /spending threshold/i.test(error)) {
    return "spending_threshold";
  }
  if (/trial mode/i.test(error)) return "trial_mode";
  if (/sender ?id/i.test(error)) return "sender_id";
  return null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function otpiqSender(channel: OtpChannel, config: OtpiqConfig): OtpSender {
  const baseUrl = config.baseUrl ?? OTPIQ_API_URL;
  const doFetch = config.fetch ?? fetch;

  return {
    async send(phone, code) {
      const body: Record<string, string> = {
        // International format without the plus.
        phoneNumber: phone.replace(/^\+/, ""),
        smsType: "verification",
        verificationCode: code,
        provider: channel,
      };
      if (channel === "sms" && config.smsSenderId) body.senderId = config.smsSenderId;
      if (channel === "whatsapp" && config.whatsapp) {
        body.whatsappAccountId = config.whatsapp.accountId;
        body.whatsappPhoneId = config.whatsapp.phoneId;
        body.templateName = config.whatsapp.templateName;
      }

      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/sms`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
          cache: "no-store",
        });
      } catch {
        // Network error or timeout.
        return { ok: false, error: "unavailable" };
      }

      const json = await readJson(response);

      if (response.ok) {
        // A 200 means the task was created, even if the body is unexpected.
        const parsed = successSchema.safeParse(json);
        return { ok: true, providerMessageId: parsed.success ? parsed.data.smsId : null };
      }

      const fail = (error: SendError, problem?: OtpiqAccountProblem["kind"]) => {
        if (problem) config.onAccountProblem?.({ channel, status: response.status, kind: problem });
        return { ok: false as const, error };
      };

      if (response.status === 401 || response.status === 403) {
        return fail("provider_account", "unauthorized");
      }
      if (response.status === 429) return fail("rate_limited");
      if (response.status === 400 || response.status === 402) {
        const problem = classifyBadRequest(json);
        return problem ? fail("provider_account", problem) : fail("rejected");
      }
      if (response.status >= 400 && response.status < 500) return fail("rejected");
      return fail("unavailable");
    },
  };
}
