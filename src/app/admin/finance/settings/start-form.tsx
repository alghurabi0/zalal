"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/dates";

import { saveFinanceSettings } from "../actions";

/** The day the books start: no record before it, and not after today. */
export function StartForm({ startOn, today }: { startOn: string; today: string }) {
  const t = useTranslations("Admin.finance.settings");
  const tErrors = useTranslations("Admin.editErrors");
  const edit = useAdminEdit();
  const [day, setDay] = useState(startOn);
  const [saved, setSaved] = useState(false);
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today;

  return (
    <form
      aria-label={t("startTitle")}
      className="flex flex-wrap items-end gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!ok) return;
        setSaved(false);
        edit.run(
          () => saveFinanceSettings({ startOn: day }),
          () => setSaved(true),
        );
      }}
    >
      <Field
        label={t("startOn")}
        variant="compact"
        className="w-60"
        error={ok ? undefined : t("startRange", { today: formatDay(today) })}
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            variant="compact"
            max={today}
            required
            value={day}
            onChange={(event) => {
              setSaved(false);
              setDay(event.target.value);
            }}
          />
        )}
      </Field>
      <Button type="submit" size="sm" loading={edit.pending} disabled={!ok || day === startOn}>
        {t("save")}
      </Button>
      <p role="status" className="min-h-11 content-center text-13 font-bold">
        {edit.error ? (
          <span className="text-danger">{tErrors(edit.error)}</span>
        ) : (
          saved && <span className="text-ok-fg">{t("saved")}</span>
        )}
      </p>
    </form>
  );
}
