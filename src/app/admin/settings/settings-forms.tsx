"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState, useTransition } from "react";

import { WeekdayPicker } from "@/components/admin/weekday-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { AdminSettings } from "@/lib/admin/catalog-queries";
import type { AdminEditError } from "@/lib/admin/edit-errors";
import { normalizeIraqiPhone } from "@/lib/phone";
import {
  LEGAL_MAX,
  SETTING_RANGES,
  type SettingsSectionInput,
  STERILANT_MAX,
} from "@/lib/schemas/admin-catalog";

import { saveSettings } from "./actions";

/** A13's sections, each with its own Save. */
export function SettingsForms({ settings }: { settings: AdminSettings }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <LoginSection settings={settings} />
      <SupportSection settings={settings} />
      <BookingSection settings={settings} />
      <CrewSection settings={settings} />
      <LegalSection settings={settings} />
    </div>
  );
}

/** A section card: its fields, Save, and the result. `input` is null while a field is invalid. */
function Section({
  title,
  input,
  className,
  children,
}: {
  title: string;
  input: SettingsSectionInput | null;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("Admin.settings");
  const tErrors = useTranslations("Admin.editErrors");
  const router = useRouter();
  const headingId = useId();
  const [error, setError] = useState<AdminEditError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Card className={className}>
      <form
        aria-labelledby={headingId}
        className="flex flex-col gap-4 p-4"
        onChange={() => setSaved(false)}
        onSubmit={(event) => {
          event.preventDefault();
          if (!input) return;
          setError(null);
          setSaved(false);
          startTransition(async () => {
            const result = await saveSettings(input);
            if (result.status === "done") {
              setSaved(true);
              router.refresh();
            } else {
              setError(result.error);
            }
          });
        }}
      >
        <h2 id={headingId} className="text-16 font-extrabold">
          {title}
        </h2>
        {children}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" loading={pending} disabled={!input}>
            {t("save")}
          </Button>
          <p role="status" className="text-13 font-bold">
            {error ? (
              <span className="text-danger">{tErrors(error)}</span>
            ) : saved ? (
              <span className="text-ok-fg">{t("saved")}</span>
            ) : null}
          </p>
        </div>
      </form>
    </Card>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex min-h-11 items-center gap-2.5 text-14 font-bold">
        <input
          id={id}
          type="checkbox"
          className="size-5 shrink-0 accent-navy"
          aria-describedby={hint ? `${id}-hint` : undefined}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
      {hint && (
        <span id={`${id}-hint`} className="text-13 text-muted">
          {hint}
        </span>
      )}
    </div>
  );
}

function LoginSection({ settings }: { settings: AdminSettings }) {
  const t = useTranslations("Admin.settings.login");
  const [sms, setSms] = useState(settings.sms_enabled);
  return (
    <Section title={t("title")} input={{ section: "login", values: { sms_enabled: sms } }}>
      <Toggle label={t("sms")} hint={t("smsHint")} checked={sms} onChange={setSms} />
    </Section>
  );
}

/** "09:00:00" → "09:00" for <input type="time">. */
const hhmm = (time: string) => time.slice(0, 5);

function SupportSection({ settings }: { settings: AdminSettings }) {
  const t = useTranslations("Admin.settings.support");
  const [phone, setPhone] = useState(settings.company_phone ?? "");
  const [start, setStart] = useState(hhmm(settings.working_hours_start));
  const [end, setEnd] = useState(hhmm(settings.working_hours_end));
  const [days, setDays] = useState(settings.working_days);
  const phoneOk = phone.trim() === "" || normalizeIraqiPhone(phone) !== null;
  const orderOk = start !== "" && end !== "" && start < end;

  return (
    <Section
      title={t("title")}
      input={
        phoneOk && orderOk
          ? {
              section: "support",
              values: {
                company_phone: phone,
                working_hours_start: start,
                working_hours_end: end,
                working_days: days,
              },
            }
          : null
      }
    >
      <Field
        label={t("phone")}
        variant="compact"
        hint={t("phoneHint")}
        error={phoneOk ? undefined : t("invalidPhone")}
      >
        {(control) => (
          <Input
            {...control}
            type="tel"
            variant="compact"
            dir="ltr"
            className="text-start"
            autoComplete="off"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-4">
        <Field label={t("start")} variant="compact" className="w-36">
          {(control) => (
            <Input
              {...control}
              type="time"
              variant="compact"
              dir="ltr"
              required
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("end")}
          variant="compact"
          className="w-36"
          error={orderOk ? undefined : t("endBeforeStart")}
        >
          {(control) => (
            <Input
              {...control}
              type="time"
              variant="compact"
              dir="ltr"
              required
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          )}
        </Field>
      </div>
      <WeekdayPicker legend={t("days")} name="working-days" value={days} onChange={setDays} />
      <p className="text-13 text-muted">{t("hoursHint")}</p>
    </Section>
  );
}

type RangeKey = keyof typeof SETTING_RANGES;

function BookingSection({ settings }: { settings: AdminSettings }) {
  const t = useTranslations("Admin.settings");
  const keys = [
    ["booking_window_days", "window"],
    ["cancel_cutoff_hours", "cutoff"],
    ["max_tanks_per_order", "maxTanks"],
    ["cleaning_interval_months", "interval"],
  ] as const satisfies readonly (readonly [RangeKey, string])[];
  const [values, setValues] = useState<Record<RangeKey, string>>({
    booking_window_days: String(settings.booking_window_days),
    cancel_cutoff_hours: String(settings.cancel_cutoff_hours),
    max_tanks_per_order: String(settings.max_tanks_per_order),
    cleaning_interval_months: String(settings.cleaning_interval_months),
  });
  const number = (key: RangeKey) => {
    const text = values[key].trim();
    const [min, max] = SETTING_RANGES[key];
    const n = /^\d{1,3}$/.test(text) ? Number(text) : Number.NaN;
    return n >= min && n <= max ? n : null;
  };
  const parsed = {
    booking_window_days: number("booking_window_days"),
    cancel_cutoff_hours: number("cancel_cutoff_hours"),
    max_tanks_per_order: number("max_tanks_per_order"),
    cleaning_interval_months: number("cleaning_interval_months"),
  };
  const {
    booking_window_days: windowDays,
    cancel_cutoff_hours: cutoff,
    max_tanks_per_order: maxTanks,
    cleaning_interval_months: interval,
  } = parsed;

  return (
    <Section
      title={t("booking.title")}
      input={
        windowDays !== null && cutoff !== null && maxTanks !== null && interval !== null
          ? {
              section: "booking",
              values: {
                booking_window_days: windowDays,
                cancel_cutoff_hours: cutoff,
                max_tanks_per_order: maxTanks,
                cleaning_interval_months: interval,
              },
            }
          : null
      }
    >
      {keys.map(([key, label]) => {
        const [min, max] = SETTING_RANGES[key];
        const range = t("rangeHint", { min, max });
        return (
          <Field
            key={key}
            label={t(`booking.${label}`)}
            variant="compact"
            hint={range}
            error={parsed[key] === null ? range : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                variant="compact"
                dir="ltr"
                className="w-32 text-start"
                name={key}
                value={values[key]}
                onChange={(event) => setValues((v) => ({ ...v, [key]: event.target.value }))}
              />
            )}
          </Field>
        );
      })}
    </Section>
  );
}

function CrewSection({ settings }: { settings: AdminSettings }) {
  const t = useTranslations("Admin.settings.crew");
  const [sterilant, setSterilant] = useState(settings.sterilant_text);
  return (
    <Section title={t("title")} input={{ section: "crew", values: { sterilant_text: sterilant } }}>
      <Field label={t("sterilant")} variant="compact" hint={t("sterilantHint")}>
        {(control) => (
          <Input
            {...control}
            variant="compact"
            maxLength={STERILANT_MAX}
            name="sterilant_text"
            value={sterilant}
            onChange={(event) => setSterilant(event.target.value)}
          />
        )}
      </Field>
    </Section>
  );
}

function LegalSection({ settings }: { settings: AdminSettings }) {
  const t = useTranslations("Admin.settings.legal");
  const [terms, setTerms] = useState(settings.terms_md);
  const [privacy, setPrivacy] = useState(settings.privacy_md);
  return (
    <Section
      title={t("title")}
      className="lg:col-span-2"
      input={{ section: "legal", values: { terms_md: terms, privacy_md: privacy } }}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label={t("terms")} variant="compact">
          {(control) => (
            <Textarea
              {...control}
              rows={12}
              maxLength={LEGAL_MAX}
              className="resize-y"
              value={terms}
              onChange={(event) => setTerms(event.target.value)}
            />
          )}
        </Field>
        <Field label={t("privacy")} variant="compact">
          {(control) => (
            <Textarea
              {...control}
              rows={12}
              maxLength={LEGAL_MAX}
              className="resize-y"
              value={privacy}
              onChange={(event) => setPrivacy(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Section>
  );
}
