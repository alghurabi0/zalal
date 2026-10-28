"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { ChannelChoice, PhoneField } from "@/components/auth/phone-field";
import { useSendErrorMessage } from "@/components/auth/use-send-error";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { SendCodeState } from "@/lib/otp/form-states";
import type { OtpChannel } from "@/lib/otp/schemas";
import { formatPhone, normalizeIraqiMobile } from "@/lib/phone";

import { sendNewPhoneCode, startPhoneChange } from "./actions";

const initialState: SendCodeState = { error: null };

function Heading({ step, children }: { step: 1 | 2; children: React.ReactNode }) {
  const t = useTranslations("PhoneChange");
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-14 font-bold text-teal">{t("step", { n: String(step) })}</p>
      <h1 className="text-28 font-black">{t("title")}</h1>
      <p className="text-16 text-muted">{children}</p>
    </div>
  );
}

function FormError({ message }: { message: string | undefined }) {
  return (
    <p
      aria-live="polite"
      className={cn("text-center text-14 font-bold text-danger", !message && "sr-only")}
    >
      {message}
    </p>
  );
}

/** Step 1: a code to the account's current number. */
export function CurrentPhoneForm({ phone, smsEnabled }: { phone: string; smsEnabled: boolean }) {
  const t = useTranslations("PhoneChange");
  const errorMessage = useSendErrorMessage();
  const [state, action, pending] = useActionState(startPhoneChange, initialState);
  const [channel, setChannel] = useState<OtpChannel>("whatsapp");
  const showSms = state.smsEnabled ?? smsEnabled;

  return (
    <form action={action} className="flex flex-1 flex-col gap-6">
      <Heading step={1}>
        {t.rich("currentIntro", {
          phone: () => (
            <span dir="ltr" className="font-extrabold text-navy">
              {formatPhone(phone)}
            </span>
          ),
        })}
      </Heading>
      <ChannelChoice smsEnabled={showSms} channel={channel} onChange={setChannel} />
      <p className="text-14 text-muted">{t("lostPhone")}</p>
      <div className="flex-1" />
      <div className="flex flex-col gap-3">
        <FormError message={state.error ? errorMessage(state.error) : undefined} />
        <Button type="submit" loading={pending}>
          {t("send")}
        </Button>
      </div>
    </form>
  );
}

/** Step 2: the new number, and a code to it. */
export function NewPhoneForm({ smsEnabled }: { smsEnabled: boolean }) {
  const t = useTranslations("PhoneChange");
  const errorMessage = useSendErrorMessage();
  const [state, action, pending] = useActionState(sendNewPhoneCode, initialState);
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<OtpChannel>("whatsapp");
  const showSms = state.smsEnabled ?? smsEnabled;
  const error = state.error;
  const phoneError =
    error && ["invalid_phone", "phone_taken", "same_phone"].includes(error.kind)
      ? errorMessage(error)
      : undefined;
  const formError = error && !phoneError ? errorMessage(error) : undefined;

  return (
    <form action={action} className="flex flex-1 flex-col gap-6">
      <Heading step={2}>{t("newIntro")}</Heading>
      <PhoneField label={t("newPhone")} value={phone} onChange={setPhone} error={phoneError} />
      <ChannelChoice smsEnabled={showSms} channel={channel} onChange={setChannel} />
      <div className="flex-1" />
      <div className="flex flex-col gap-3">
        <FormError message={formError} />
        <Button type="submit" disabled={normalizeIraqiMobile(phone) === null} loading={pending}>
          {t("send")}
        </Button>
      </div>
    </form>
  );
}
