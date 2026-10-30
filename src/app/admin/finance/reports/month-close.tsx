"use client";

import { Lock, LockOpen, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NOTE_MAX } from "@/lib/schemas/finance";

import { closeFinanceMonth, reopenFinanceMonth } from "../actions";

// A20's month close (spec §8.3 "Reports"): "أقفل الشهر" asks once, with what
// the close stops; "افتح الشهر" asks for the reason, which the audit log keeps.

export function CloseMonth({ month, label }: { month: string; label: string }) {
  const t = useTranslations("Admin.finance.reports");
  const tFinance = useTranslations("Admin.finance");
  const tErrors = useTranslations("Admin.editErrors");
  const edit = useAdminEdit();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <Button size="sm" className="self-start" onClick={() => setOpen(true)}>
          <Lock aria-hidden className="size-4" />
          {t("close")}
        </Button>
        <p role="status" className="text-13 font-bold text-ok-fg">
          {done && t("closed")}
        </p>
      </div>
    );
  }
  return (
    <form
      aria-label={t("closeTitle", { month: label })}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        edit.run(
          () => closeFinanceMonth({ month }),
          () => {
            setOpen(false);
            setDone(true);
          },
        );
      }}
    >
      <h3 className="text-16 font-extrabold">{t("closeTitle", { month: label })}</h3>
      <p className="text-14 text-body-2">{t("closeBody")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={edit.pending}>
          {t("closeConfirm")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
          {tFinance("cancel")}
        </Button>
        <p role="status" className="text-13 font-bold text-danger">
          {edit.error && tErrors(edit.error)}
        </p>
      </div>
    </form>
  );
}

export function ReopenMonth({ month, label }: { month: string; label: string }) {
  const t = useTranslations("Admin.finance.reports");
  const tFinance = useTranslations("Admin.finance");
  const tErrors = useTranslations("Admin.editErrors");
  const edit = useAdminEdit();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const ok = reason.trim().length > 0;

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <Button size="sm" variant="secondary" className="self-start" onClick={() => setOpen(true)}>
          <LockOpen aria-hidden className="size-4" />
          {t("reopen")}
        </Button>
        <p role="status" className="text-13 font-bold text-ok-fg">
          {done && t("reopened")}
        </p>
      </div>
    );
  }
  return (
    <form
      aria-label={t("reopenTitle", { month: label })}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!ok) return;
        edit.run(
          () => reopenFinanceMonth({ month, reason }),
          () => {
            setOpen(false);
            setDone(true);
          },
        );
      }}
    >
      <h3 className="text-16 font-extrabold">{t("reopenTitle", { month: label })}</h3>
      <p className="text-14 text-body-2">{t("reopenBody")}</p>
      <Field
        label={t("reopenReason")}
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
          {t("reopenConfirm")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
          {tFinance("cancel")}
        </Button>
        <p role="status" className="text-13 font-bold text-danger">
          {edit.error && tErrors(edit.error)}
        </p>
      </div>
    </form>
  );
}

/** "طباعة": the browser's print, which leaves out the sidebar, tabs and buttons. */
export function PrintButton() {
  const t = useTranslations("Admin.finance.reports");
  return (
    <Button size="sm" variant="secondary" onClick={() => window.print()}>
      <Printer aria-hidden className="size-4" />
      {t("print")}
    </Button>
  );
}
