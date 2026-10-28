"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { useSendErrorMessage, useWaitMessage } from "@/components/auth/use-send-error";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { identifyUser } from "@/lib/monitoring/analytics";
import { OTP_LENGTH, type OtpChannel } from "@/lib/otp/schemas";
import { formatPhone, toWesternDigits } from "@/lib/phone";

import type { ResendState, VerifyState } from "@/lib/otp/form-states";

type OtpFormProps = {
  phone: string;
  channel: OtpChannel;
  smsEnabled: boolean;
  /** Seconds left before "أعد الإرسال" when the page was rendered. */
  waitS: number;
  resendAfterS: number;
  /** "تغيير الرقم" goes here; hidden without it (the phone change's current number). */
  changeHref?: string;
  /** Checks the code (the 6th digit submits). On "ok" the form goes to its destination. */
  verifyAction: (prev: VerifyState, form: FormData) => Promise<VerifyState>;
  /** "أعد الإرسال" and "أرسل برسالة SMS", with the channel in the form. */
  resendAction: (prev: ResendState, form: FormData) => Promise<ResendState>;
};

/** "0:45" */
function formatCountdown(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function OtpForm({
  phone,
  smsEnabled,
  waitS,
  resendAfterS,
  changeHref,
  verifyAction,
  resendAction,
  ...props
}: OtpFormProps) {
  const t = useTranslations("Otp");
  const sendErrorMessage = useSendErrorMessage();
  const waitMessage = useWaitMessage();
  const router = useRouter();
  const errorId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [code, setCode] = useState("");
  const [focused, setFocused] = useState(false);
  const [channel, setChannel] = useState(props.channel);
  // Each message shows until the next attempt of the other kind, or typing.
  const [showVerifyError, setShowVerifyError] = useState(true);
  const [showResendResult, setShowResendResult] = useState(true);

  // Resend countdown, measured from when this page mounted.
  const [remaining, setRemaining] = useState(waitS);
  const deadline = useRef(0);
  useEffect(() => {
    deadline.current = Date.now() + waitS * 1000;
    const timer = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [waitS]);

  const [verifyState, verify, verifying] = useActionState(
    async (prev: VerifyState, form: FormData): Promise<VerifyState> => {
      const result = await verifyAction(prev, form);
      setShowVerifyError(true);
      setShowResendResult(false);
      if (result.status === "ok") {
        if (result.userId) identifyUser(result.userId);
        router.replace(result.destination);
      } else {
        setCode("");
        inputRef.current?.focus();
      }
      return result;
    },
    { status: "idle" },
  );

  const [resendState, resend, resending] = useActionState(
    async (prev: ResendState, form: FormData): Promise<ResendState> => {
      const result = await resendAction(prev, form);
      setShowResendResult(true);
      setShowVerifyError(false);
      if (!result.error) {
        deadline.current = Date.now() + resendAfterS * 1000;
        setRemaining(resendAfterS);
        if (result.channel) setChannel(result.channel);
        setCode("");
        inputRef.current?.focus();
      }
      return result;
    },
    { error: null },
  );

  const verifyError = (() => {
    if (!showVerifyError) return null;
    switch (verifyState.status) {
      case "wrong_code":
        return t("errors.wrongCode", {
          n: verifyState.attemptsLeft,
          count: String(verifyState.attemptsLeft),
        });
      case "locked":
        return t("errors.locked", { wait: waitMessage(verifyState.retryAfterS) });
      case "expired":
        return t("errors.expired");
      case "account_unavailable":
        return t("errors.accountUnavailable");
      case "phone_taken":
        return t("errors.phoneTaken");
      case "invalid_code":
        return t("errors.invalidCode");
      default:
        return null;
    }
  })();
  const resendError =
    showResendResult && resendState.error ? sendErrorMessage(resendState.error) : null;
  const message = resendError ?? verifyError;
  const resent = showResendResult && !resendState.error && resendState.sentAt !== undefined;
  const busy = verifying || resending || verifyState.status === "ok";

  const onCodeChange = (value: string) => {
    const digits = toWesternDigits(value).replace(/\D/g, "").slice(0, OTP_LENGTH);
    flushSync(() => {
      setCode(digits);
      if (digits.length > 0) {
        setShowVerifyError(false);
        setShowResendResult(false);
      }
    });
    // Auto-submit at 6 digits (spec §5.3), also after paste or SMS autofill.
    if (digits.length === OTP_LENGTH && !busy) formRef.current?.requestSubmit();
  };

  return (
    <form ref={formRef} action={verify} className="flex flex-1 flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-28 font-black">{t("title")}</h1>
        <p className="text-16 text-muted">
          {t.rich("sentTo", {
            channel,
            phone: () => (
              <span dir="ltr" className="font-extrabold text-navy">
                {formatPhone(phone)}
              </span>
            ),
          })}
        </p>
        {changeHref && (
          <Link
            href={changeHref}
            className="flex min-h-11 items-center self-start text-14 font-bold text-teal underline"
          >
            {t("changeNumber")}
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {/* One real input (system number keyboard, paste, SMS autofill)
            drawn as 6 boxes (spec §5.3). It covers the boxes, invisible. */}
        <div dir="ltr" className="relative grid grid-cols-6 gap-2">
          {Array.from({ length: OTP_LENGTH }, (_, i) => {
            const filled = i < code.length;
            const current = focused && i === Math.min(code.length, OTP_LENGTH - 1) && !filled;
            return (
              <div
                key={i}
                aria-hidden
                className={cn(
                  "flex h-14 items-center justify-center rounded-input border-2 bg-surface text-24 font-extrabold",
                  current ? "border-teal" : filled ? "border-otp-filled" : "border-border",
                  verifyError && !filled && !focused && "border-danger",
                )}
              >
                {code[i]}
              </div>
            );
          })}
          <input
            ref={inputRef}
            name="code"
            aria-label={t("codeLabel")}
            aria-describedby={message ? errorId : undefined}
            aria-invalid={verifyError ? true : undefined}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={OTP_LENGTH}
            autoFocus
            value={code}
            disabled={verifyState.status === "ok"}
            onChange={(event) => onCodeChange(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(event) => {
              // Enter submits the code, never the resend buttons.
              if (event.key === "Enter") {
                event.preventDefault();
                if (code.length === OTP_LENGTH && !busy) formRef.current?.requestSubmit();
              }
            }}
            className="absolute inset-0 size-full cursor-text text-16 text-transparent caret-transparent opacity-0"
          />
        </div>
        <p
          id={errorId}
          aria-live="polite"
          className={cn(
            "text-14 font-bold",
            message ? "text-danger" : "text-ok-fg",
            !message && !resent && "sr-only",
          )}
        >
          {message ?? (resent ? t("resent") : null)}
        </p>
      </div>

      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-2">
        <span className="text-14 text-muted">{t("notReceived")}</span>
        {remaining > 0 ? (
          <span className="text-14 font-bold text-muted">
            {t.rich("resendIn", {
              time: () => <span dir="ltr">{formatCountdown(remaining)}</span>,
            })}
          </span>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              type="submit"
              formAction={resend}
              name="channel"
              value={channel}
              variant="link"
              size="sm"
              className="px-2 text-14"
              disabled={busy}
            >
              {t("resend")}
            </Button>
            {smsEnabled && channel === "whatsapp" && (
              <Button
                type="submit"
                formAction={resend}
                name="channel"
                value="sms"
                variant="link"
                size="sm"
                className="px-2 text-14"
                disabled={busy}
              >
                {t("resendSms")}
              </Button>
            )}
          </div>
        )}
      </div>

      <Button
        type="submit"
        disabled={code.length < OTP_LENGTH}
        loading={verifying || verifyState.status === "ok"}
      >
        {t("verify")}
      </Button>
    </form>
  );
}
