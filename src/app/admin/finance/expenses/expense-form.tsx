"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Money } from "@/components/admin/finance";
import { AmountField, ReadOnlyRecord, VoidForm } from "@/components/admin/finance-forms";
import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import type { Expense, ExpenseCategory } from "@/lib/admin/finance-queries";
import { formatDay, formatDayTime } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { expenseSchema, NOTE_MAX, parseAmount } from "@/lib/schemas/finance";

import { saveExpense, voidExpense } from "../actions";

type Option = { id: string; label: string; active: boolean };
type WorkerOption = { id: string; name: string; active: boolean };

/**
 * A16's expense drawer: record an expense, or edit or void one. A
 * switched-off box or category stays a choice only where the expense
 * already uses it; a voided expense is shown, not edited.
 */
export function ExpenseForm({
  expense,
  accounts,
  categories,
  workers,
  payWorker,
  today,
  firstDay,
  closed = false,
  closeHref,
}: {
  expense: Expense | null;
  accounts: Option[];
  categories: ExpenseCategory[];
  /** Workers a wage can pay (A21). */
  workers: WorkerOption[];
  /** A new wage for this worker (A21's "ادفع له"), with what they're owed. */
  payWorker?: { id: string; owedIqd: number } | null;
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
  const defaultAccount = accounts.find((account) => account.active)?.id ?? "";
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? today);
  const wagesCategory = categories.find((c) => c.active && c.kind === "wages");
  const [categoryId, setCategoryId] = useState(
    expense
      ? String(expense.categoryId)
      : payWorker && wagesCategory
        ? String(wagesCategory.id)
        : "",
  );
  const [accountId, setAccountId] = useState(expense?.accountId ?? defaultAccount);
  const [amount, setAmount] = useState(
    expense
      ? formatIQD(expense.amountIqd)
      : payWorker && payWorker.owedIqd > 0
        ? formatIQD(payWorker.owedIqd)
        : "",
  );
  const [workerId, setWorkerId] = useState(expense?.workerId ?? payWorker?.id ?? "");
  const isWages = categories.find((c) => String(c.id) === categoryId)?.kind === "wages";
  const [note, setNote] = useState(expense?.note ?? "");
  const [tried, setTried] = useState(false);

  if (expense && (expense.voidedAt || closed)) {
    return (
      <ReadOnlyRecord
        rows={[
          [t("expense.date"), formatDay(expense.spentOn)],
          [t("expense.category"), categories.find((c) => c.id === expense.categoryId)?.name],
          [t("expense.account"), accounts.find((a) => a.id === expense.accountId)?.label],
          ...(expense.workerId
            ? [
                [t("expense.worker"), workers.find((w) => w.id === expense.workerId)?.name] as [
                  string,
                  string | undefined,
                ],
              ]
            : []),
          [t("amount"), <Money key="amount" amount={expense.amountIqd} />],
          [t("expense.note"), expense.note ?? t("none")],
        ]}
        voidedAt={expense.voidedAt}
        voidedBy={expense.voidedBy}
        reason={expense.voidReason}
      />
    );
  }

  const input = {
    id: expense?.id ?? null,
    spentOn,
    categoryId: Number(categoryId),
    accountId,
    amountIqd: parseAmount(amount) ?? 0,
    note,
    workerId: isWages && workerId ? workerId : null,
  };
  const valid = expenseSchema.safeParse(input).success;
  const dayOk = spentOn >= firstDay && spentOn <= today;

  return (
    <div className="flex flex-col gap-5">
      <form
        aria-label={expense ? t("expense.editTitle") : t("expense.newTitle")}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (!valid || !dayOk) return;
          edit.run(
            () => saveExpense(input),
            () => router.push(closeHref, { scroll: false }),
          );
        }}
      >
        <Field
          label={t("expense.date")}
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
              value={spentOn}
              onChange={(event) => setSpentOn(event.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("expense.category")}
            variant="compact"
            error={tried && !categoryId ? t("pickCategory") : undefined}
          >
            {(control) => (
              <Select
                {...control}
                variant="compact"
                required
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="" disabled>
                  {t("pickCategory")}
                </option>
                {categories
                  .filter((c) => c.active || c.id === expense?.categoryId)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field
            label={t("expense.account")}
            variant="compact"
            error={tried && !accountId ? t("pickBox") : undefined}
          >
            {(control) => (
              <Select
                {...control}
                variant="compact"
                required
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                <option value="" disabled>
                  {t("pickBox")}
                </option>
                {accounts
                  .filter((a) => a.active || a.id === expense?.accountId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>
        {isWages && (
          <Field label={t("expense.worker")} variant="compact" hint={t("expense.workerHint")}>
            {(control) => (
              <Select
                {...control}
                variant="compact"
                value={workerId}
                onChange={(event) => setWorkerId(event.target.value)}
              >
                <option value="">{t("expense.noWorker")}</option>
                {workers
                  .filter((w) => w.active || w.id === expense?.workerId)
                  .map((worker) => (
                    <option key={worker.id} value={worker.id}>
                      {worker.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
        <AmountField value={amount} onChange={setAmount} showError={tried} />
        <Field label={t("expense.note")} variant="compact" hint={t("noteHint")}>
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
        {expense && (
          <p className="text-13 text-muted">
            {t("recordedBy", {
              name: expense.createdBy ?? t("unknownAdmin"),
              when: formatDayTime(expense.createdAt),
            })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={edit.pending}>
            {expense ? t("save") : t("expense.create")}
          </Button>
          <Button size="sm" variant="secondary" href={closeHref} scroll={false}>
            {t("cancel")}
          </Button>
          <p role="status" className="text-13 font-bold text-danger">
            {edit.error && tErrors(edit.error)}
          </p>
        </div>
      </form>
      {expense && (
        <VoidForm
          title={t("expense.voidTitle")}
          hint={t("expense.voidHint")}
          onVoid={(reason) => voidExpense({ id: expense.id, reason })}
          closeHref={closeHref}
        />
      )}
    </div>
  );
}
