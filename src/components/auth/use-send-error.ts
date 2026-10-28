import { useTranslations } from "next-intl";

import type { SendError } from "@/lib/otp/form-states";

/** "جرب بعد 3 دقايق" or "جرب بعد 40 ثانية", rounded up. */
export function useWaitMessage() {
  const t = useTranslations("Login.errors");
  return (seconds: number) => {
    if (seconds < 60) return t("tryAfterSeconds", { count: String(Math.max(1, seconds)) });
    const minutes = Math.ceil(seconds / 60);
    // `n` picks the Arabic plural form; `count` is the number as typed
    // (Western digits: ICU's own number formatting would use Arabic-Indic).
    return t("tryAfterMinutes", { n: minutes, count: String(minutes) });
  };
}

/** Words a failed send for Login and OTP (spec §5.2 errors). */
export function useSendErrorMessage() {
  const t = useTranslations("Login.errors");
  const wait = useWaitMessage();
  return (error: SendError) => {
    switch (error.kind) {
      case "invalid_phone":
        return t("invalidPhone");
      case "wait":
        return wait(error.retryAfterS);
      case "locked":
        return t("locked", { wait: wait(error.retryAfterS) });
      case "sms_disabled":
        return t("smsDisabled");
      case "whatsapp_failed":
        return error.canTrySms ? t("whatsappFailed") : t("sendFailed");
      case "send_failed":
        return t("sendFailed");
      case "phone_taken":
        return t("phoneTaken");
      case "same_phone":
        return t("samePhone");
    }
  };
}
