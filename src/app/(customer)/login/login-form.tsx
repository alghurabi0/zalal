"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { ChannelChoice, PhoneField } from "@/components/auth/phone-field";
import { useSendErrorMessage } from "@/components/auth/use-send-error";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { OtpChannel } from "@/lib/otp/schemas";
import { normalizeIraqiMobile } from "@/lib/phone";
import { routes } from "@/lib/routes";

import type { SendCodeState } from "@/lib/otp/form-states";

import { sendCode } from "./actions";

const initialState: SendCodeState = { error: null };

export function LoginForm({ smsEnabled, next }: { smsEnabled: boolean; next: string | null }) {
  const t = useTranslations("Login");
  const errorMessage = useSendErrorMessage();
  const [state, action, pending] = useActionState(sendCode, initialState);
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<OtpChannel>("whatsapp");
  const formRef = useRef<HTMLFormElement>(null);

  // The server's answer wins: the admin may have switched SMS off meanwhile.
  const showSms = state.smsEnabled ?? smsEnabled;
  const valid = normalizeIraqiMobile(phone) !== null;
  const error = state.error;
  const phoneError = error?.kind === "invalid_phone" ? errorMessage(error) : undefined;
  const formError = error && error.kind !== "invalid_phone" ? errorMessage(error) : undefined;
  const offerSms = error?.kind === "whatsapp_failed" && error.canTrySms && showSms;

  const sendBySms = () => {
    flushSync(() => setChannel("sms"));
    formRef.current?.requestSubmit();
  };

  return (
    <form ref={formRef} action={action} className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-28 font-black">{t("title")}</h1>
        <p className="text-16 text-muted">{showSms ? t("intro") : t("introWhatsapp")}</p>
      </div>

      <PhoneField value={phone} onChange={setPhone} error={phoneError} />

      <ChannelChoice smsEnabled={showSms} channel={channel} onChange={setChannel} />

      {next && <input type="hidden" name="next" value={next} />}

      <div className="flex-1" />

      <div className="flex flex-col gap-3">
        <div aria-live="polite" className={cn(!formError && "sr-only")}>
          {formError && (
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="text-14 font-bold text-danger">{formError}</p>
              {offerSms && (
                <Button variant="link" size="sm" onClick={sendBySms} disabled={pending}>
                  {t("errors.sendSms")}
                </Button>
              )}
            </div>
          )}
        </div>
        <Button type="submit" disabled={!valid} loading={pending}>
          {t("send")}
        </Button>
        <p className="text-center text-13 text-muted">
          {t.rich("terms", {
            terms: (chunks) => (
              <Link href={routes.terms} className="font-bold text-teal underline">
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link href={routes.privacy} className="font-bold text-teal underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
    </form>
  );
}
