"use client";

import { Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AdminEditFailure } from "@/lib/admin/edit-errors";
import { formatDayTime } from "@/lib/dates";
import { AMOUNT_MAX, NOTE_MAX, parseAmount } from "@/lib/schemas/finance";

// Form pieces the accounting drawers share (spec §8.3 A15, A16).

/** Whole IQD, typed with or without commas or in Arabic-Indic digits. */
export function AmountField({
  value,
  onChange,
  showError,
}: {
  value: string;
  onChange: (value: string) => void;
  showError: boolean;
}) {
  const t = useTranslations("Admin.finance");
  const amount = parseAmount(value);
  const ok = amount !== null && amount >= 1 && amount <= AMOUNT_MAX;
  return (
    <Field
      label={t("amount")}
      variant="compact"
      hint={t("amountHint")}
      error={showError && !ok ? t("amountRange") : undefined}
    >
      {(control) => (
        <Input
          {...control}
          variant="compact"
          inputMode="numeric"
          dir="ltr"
          className="text-end"
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * "ألغِ السجل": voiding keeps the record out of every total, with the
 * reason. It asks for the reason first, then closes the drawer.
 */
export function VoidForm({
  title,
  hint,
  onVoid,
  closeHref,
}: {
  title: string;
  hint: string;
  onVoid: (reason: string) => Promise<{ status: "done" } | AdminEditFailure>;
  closeHref: string;
}) {
  const t = useTranslations("Admin.finance");
  const tErrors = useTranslations("Admin.editErrors");
  const router = useRouter();
  const edit = useAdminEdit();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const ok = reason.trim().length > 0;

  if (!open) {
    return (
      <Button size="sm" variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        <Ban aria-hidden className="size-4" />
        {title}
      </Button>
    );
  }
  return (
    <form
      aria-label={title}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!ok) return;
        edit.run(
          () => onVoid(reason),
          () => router.push(closeHref, { scroll: false }),
        );
      }}
    >
      <h3 className="text-16 font-extrabold">{title}</h3>
      <p className="text-13 text-body-2">{hint}</p>
      <Field
        label={t("voidReason")}
        variant="compact"
        error={tried && !ok ? tErrors("reason_required") : undefined}
      >
        {(control) => (
          <Input
            {...control}
            variant="compact"
            maxLength={NOTE_MAX}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={edit.pending}>
          {t("voidConfirm")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
        <p role="status" className="text-13 font-bold text-danger">
          {edit.error && tErrors(edit.error)}
        </p>
      </div>
    </form>
  );
}

/**
 * A record shown, not edited: its values under a banner that says why. A
 * voided record names who voided it, when and why; one dated in a closed
 * month (A20) says the month is closed.
 */
export function ReadOnlyRecord({
  rows,
  voidedAt,
  voidedBy,
  reason,
}: {
  rows: [string, ReactNode][];
  /** Null for a live record in a closed month. */
  voidedAt: string | null;
  voidedBy: string | null;
  reason: string | null;
}) {
  const t = useTranslations("Admin.finance");
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-chip bg-warn-bg px-3 py-2 text-14 font-bold text-warn-fg">
        {voidedAt ? (
          <>
            {t("voidedBanner", {
              name: voidedBy ?? t("unknownAdmin"),
              when: formatDayTime(voidedAt),
            })}
            {reason && (
              <>
                <br />
                {t("voidedReason", { reason })}
              </>
            )}
          </>
        ) : (
          t("closedRecord")
        )}
      </p>
      <Card className="p-4">
        <dl className="flex flex-col gap-2.5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-13 text-muted">{label}</dt>
              <dd className="text-15 font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
