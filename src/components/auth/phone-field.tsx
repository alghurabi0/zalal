"use client";

import { useTranslations } from "next-intl";

import { IraqFlag } from "@/components/illustrations/iraq-flag";
import { Chip, ChipGroup } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { OtpChannel } from "@/lib/otp/schemas";
import { normalizeIraqiMobile } from "@/lib/phone";

/**
 * The +964 phone field from Login (Login.dc.html), also used by the phone
 * change (N10). Posts as `phone`; the border turns teal on a valid number.
 */
export function PhoneField({
  label,
  value,
  onChange,
  error,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const t = useTranslations("Login");
  const valid = normalizeIraqiMobile(value) !== null;

  return (
    <Field label={label ?? t("phone")} hint={t("phoneHint")} error={error}>
      {(control) => (
        <div dir="ltr" className="flex gap-2">
          <div className="flex h-14 items-center gap-1.5 rounded-input border border-border bg-surface px-3.5 text-16 font-bold">
            <IraqFlag />
            {t("countryCode")}
          </div>
          <Input
            {...control}
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={20}
            placeholder={t("phonePlaceholder")}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={cn(
              "flex-1 border-2 px-4 text-18 font-bold tracking-phone focus:ring-0",
              valid && "border-teal",
            )}
          />
        </div>
      )}
    </Field>
  );
}

/** Login's WhatsApp / SMS choice. Posts as `channel`; SMS only while it is on. */
export function ChannelChoice({
  smsEnabled,
  channel,
  onChange,
}: {
  smsEnabled: boolean;
  channel: OtpChannel;
  onChange: (channel: OtpChannel) => void;
}) {
  const t = useTranslations("Login");
  return (
    <ChipGroup
      legend={t("channelLegend")}
      legendClassName="mb-2.5 text-14 font-bold"
      bodyClassName="grid grid-cols-2 gap-2.5"
    >
      <Chip
        type="radio"
        name="channel"
        value="whatsapp"
        checked={channel === "whatsapp" || !smsEnabled}
        onChange={() => onChange("whatsapp")}
        className={cn("h-13 rounded-input text-15", !smsEnabled && "col-span-2")}
      >
        {t("whatsapp")}
      </Chip>
      {smsEnabled && (
        <Chip
          type="radio"
          name="channel"
          value="sms"
          checked={channel === "sms"}
          onChange={() => onChange("sms")}
          className="h-13 rounded-input text-15"
        >
          {t("sms")}
        </Chip>
      )}
    </ChipGroup>
  );
}
