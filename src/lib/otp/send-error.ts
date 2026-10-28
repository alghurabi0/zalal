import type { RequestOtpResult } from "@/lib/otp/service";
import type { SendCodeState } from "@/lib/otp/form-states";

/** Words a refused or failed send for the screens. Also used by the phone change. */
export function sendError(
  result: Exclude<RequestOtpResult, { ok: true }>,
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
