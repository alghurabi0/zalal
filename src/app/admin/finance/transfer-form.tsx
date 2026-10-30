"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { AmountField, VoidForm, ReadOnlyRecord } from "@/components/admin/finance-forms";
import { Money } from "@/components/admin/finance";
import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import type { Transfer } from "@/lib/admin/finance-queries";
import { formatDay, formatDayTime } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { NOTE_MAX, parseAmount, transferSchema } from "@/lib/schemas/finance";

import { saveTransfer, voidTransfer } from "./actions";

type Option = { id: string; label: string; active: boolean };

/**
 * A15's transfer drawer: a new transfer (a crew's handover comes filled in
 * with its box, the cash box and what it holds), or an existing one to edit
 * or void. A voided transfer is shown, not edited.
 */
export function TransferForm({
  transfer,
  accounts,
  defaults,
  today,
  firstDay,
  closed = false,
  closeHref,
}: {
  transfer: Transfer | null;
  accounts: Option[];
  defaults: { fromAccountId: string; toAccountId: string; amount: number | null };
  today: string;
  /** The first day a record may take: the start day, or the day after the last closed month. */
  firstDay: string;
  /** The record is dated in a closed month: shown, not edited. */
  closed?: boolean;
  closeHref: string;
}) {
  const t = useTranslations("Admin.finance");
  const tErrors = useTranslations("Admin.editErrors");
  const router = useRouter();
  const edit = useAdminEdit();
  const [movedOn, setMovedOn] = useState(transfer?.movedOn ?? today);
  const [fromId, setFromId] = useState(transfer?.fromAccountId ?? defaults.fromAccountId);
  const [toId, setToId] = useState(transfer?.toAccountId ?? defaults.toAccountId);
  const [amount, setAmount] = useState(
    transfer ? formatIQD(transfer.amountIqd) : defaults.amount ? formatIQD(defaults.amount) : "",
  );
  const [note, setNote] = useState(transfer?.note ?? "");
  const [tried, setTried] = useState(false);

  if (transfer && (transfer.voidedAt || closed)) {
    return (
      <ReadOnlyRecord
        rows={[
          [t("transfer.date"), formatDay(transfer.movedOn)],
          [t("transfer.from"), accounts.find((a) => a.id === transfer.fromAccountId)?.label],
          [t("transfer.to"), accounts.find((a) => a.id === transfer.toAccountId)?.label],
          [t("transfer.amount"), <Money key="amount" amount={transfer.amountIqd} />],
          [t("transfer.note"), transfer.note ?? t("none")],
        ]}
        voidedAt={transfer.voidedAt}
        voidedBy={transfer.voidedBy}
        reason={transfer.voidReason}
      />
    );
  }

  // A switched-off box stays listed only where the transfer already uses it.
  const choices = (current: string) =>
    accounts.filter((account) => account.active || account.id === current);
  const amountIqd = parseAmount(amount);
  const input = {
    id: transfer?.id ?? null,
    movedOn,
    fromAccountId: fromId,
    toAccountId: toId,
    amountIqd: amountIqd ?? 0,
    note,
  };
  const valid = transferSchema.safeParse(input).success;
  const dayOk = movedOn >= firstDay && movedOn <= today;

  return (
    <div className="flex flex-col gap-5">
      <form
        aria-label={transfer ? t("transfer.editTitle") : t("transfer.newTitle")}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (!valid || !dayOk) return;
          edit.run(
            () => saveTransfer(input),
            () => router.push(closeHref, { scroll: false }),
          );
        }}
      >
        <Field
          label={t("transfer.date")}
          variant="compact"
          error={
            tried && !dayOk
              ? t("dayRange", { from: formatDay(firstDay), to: formatDay(today) })
              : undefined
          }
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              variant="compact"
              min={firstDay}
              max={today}
              required
              value={movedOn}
              onChange={(event) => setMovedOn(event.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("transfer.from")}
            variant="compact"
            error={tried && !fromId ? t("pickBox") : undefined}
          >
            {(control) => (
              <Select
                {...control}
                variant="compact"
                required
                value={fromId}
                onChange={(event) => setFromId(event.target.value)}
              >
                <option value="" disabled>
                  {t("pickBox")}
                </option>
                {choices(transfer?.fromAccountId ?? "").map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t("transfer.to")}
            variant="compact"
            error={
              tried && !toId
                ? t("pickBox")
                : toId && toId === fromId
                  ? tErrors("same_account")
                  : undefined
            }
          >
            {(control) => (
              <Select
                {...control}
                variant="compact"
                required
                value={toId}
                onChange={(event) => setToId(event.target.value)}
              >
                <option value="" disabled>
                  {t("pickBox")}
                </option>
                {choices(transfer?.toAccountId ?? "").map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <AmountField value={amount} onChange={setAmount} showError={tried} />
        <Field label={t("transfer.note")} variant="compact" hint={t("noteHint")}>
          {(control) => (
            <Input
              {...control}
              variant="compact"
              maxLength={NOTE_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
        {transfer && (
          <p className="text-13 text-muted">
            {t("recordedBy", {
              name: transfer.createdBy ?? t("unknownAdmin"),
              when: formatDayTime(transfer.createdAt),
            })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={edit.pending}>
            {transfer ? t("save") : t("transfer.create")}
          </Button>
          <Button size="sm" variant="secondary" href={closeHref} scroll={false}>
            {t("cancel")}
          </Button>
          <p role="status" className="text-13 font-bold text-danger">
            {edit.error && tErrors(edit.error)}
          </p>
        </div>
      </form>
      {transfer && (
        <VoidForm
          title={t("transfer.voidTitle")}
          hint={t("transfer.voidHint")}
          onVoid={(reason) => voidTransfer({ id: transfer.id, reason })}
          closeHref={closeHref}
        />
      )}
    </div>
  );
}
