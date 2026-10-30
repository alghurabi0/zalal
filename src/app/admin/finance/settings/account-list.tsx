"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useState } from "react";

import { Money } from "@/components/admin/finance";
import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import type { FinanceAccount } from "@/lib/admin/finance-queries";
import { cn } from "@/lib/cn";
import { formatIQD } from "@/lib/money";
import {
  AMOUNT_MAX,
  FINANCE_NAME_MAX,
  OWN_ACCOUNT_KINDS,
  parseAmount,
} from "@/lib/schemas/finance";

import { saveFinanceAccount } from "../actions";

type Account = FinanceAccount & { label: string };
type OwnKind = (typeof OWN_ACCOUNT_KINDS)[number];

const nameOk = (name: string) => {
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= FINANCE_NAME_MAX;
};
const openingOk = (value: string) => {
  const amount = parseAmount(value);
  return amount !== null && Math.abs(amount) <= AMOUNT_MAX;
};

/** A17's boxes: each with its kind, opening balance and state, edited in place; "صندوق جديد". */
export function AccountList({ accounts }: { accounts: Account[] }) {
  const t = useTranslations("Admin.finance");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const columns = ["name", "kind", "opening", "balance", "state"] as const;

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className={cn("text-14 font-bold text-ok-fg", !notice && "sr-only")}>
        {notice}
      </p>
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full min-w-3xl text-14">
          <caption className="sr-only">{t("settings.boxesTitle")}</caption>
          <thead className="bg-well text-13 text-muted">
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col" className="px-3 py-2.5 text-start font-bold">
                  {t(`settings.boxColumns.${column}`)}
                </th>
              ))}
              <th scope="col" className="px-3 py-2.5">
                <span className="sr-only">{t("edit")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <Fragment key={account.id}>
                <tr className={cn("border-t border-divider", !account.active && "text-muted")}>
                  <th scope="row" className="px-3 py-3 text-start font-extrabold">
                    {account.label}
                  </th>
                  <td className="px-3 py-3">{t(`kinds.${account.kind}`)}</td>
                  <td className="px-3 py-3">
                    <Money amount={account.openingBalanceIqd} />
                  </td>
                  <td className="px-3 py-3">
                    <Money amount={account.balanceIqd} />
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded-10 px-2 py-0.5 text-12 font-extrabold",
                        account.active ? "bg-ok-bg text-ok-fg" : "bg-well text-muted",
                      )}
                    >
                      {account.active ? t("active") : t("inactive")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Button
                      size="sm"
                      variant={editing === account.id ? "primary" : "secondary"}
                      aria-expanded={editing === account.id}
                      aria-label={t("editLabel", { name: account.label })}
                      onClick={() => {
                        setNotice(null);
                        setEditing(editing === account.id ? null : account.id);
                      }}
                    >
                      {t("edit")}
                    </Button>
                  </td>
                </tr>
                {editing === account.id && (
                  <tr className="bg-bg">
                    <td colSpan={6} className="px-3 py-4">
                      <AccountForm
                        account={account}
                        onDone={() => {
                          setEditing(null);
                          setNotice(t("saved"));
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {adding ? (
        <div className="rounded-card border border-border bg-surface p-4">
          <AccountForm
            account={null}
            onDone={() => {
              setAdding(false);
              setNotice(t("settings.boxAdded"));
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => {
            setNotice(null);
            setAdding(true);
          }}
        >
          <Plus aria-hidden className="size-4" />
          {t("settings.addBox")}
        </Button>
      )}
    </div>
  );
}

function AccountForm({
  account,
  onDone,
  onCancel,
}: {
  account: Account | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Admin.finance");
  const tErrors = useTranslations("Admin.editErrors");
  const edit = useAdminEdit();
  const isCrew = account?.kind === "crew";
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<OwnKind>(
    account && account.kind !== "crew" ? account.kind : "cash",
  );
  const [opening, setOpening] = useState(formatIQD(account?.openingBalanceIqd ?? 0));
  const [active, setActive] = useState(account?.active ?? true);
  const [tried, setTried] = useState(false);
  const ok = (isCrew || nameOk(name)) && openingOk(opening);
  const title = account ? t("editLabel", { name: account.label }) : t("settings.addBox");

  return (
    <form
      aria-label={title}
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!ok) return;
        edit.run(
          () =>
            saveFinanceAccount({
              id: account?.id ?? null,
              kind: isCrew ? null : kind,
              name: isCrew ? null : name,
              openingBalanceIqd: parseAmount(opening) ?? 0,
              active,
            }),
          onDone,
        );
      }}
    >
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        {!isCrew && (
          <>
            <Field
              label={t("settings.boxName")}
              variant="compact"
              className="w-64"
              error={tried && !nameOk(name) ? t("nameRange", { max: FINANCE_NAME_MAX }) : undefined}
            >
              {(control) => (
                <Input
                  {...control}
                  variant="compact"
                  maxLength={FINANCE_NAME_MAX + 10}
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>
            <Field label={t("settings.boxKind")} variant="compact" className="w-48">
              {(control) => (
                <Select
                  {...control}
                  variant="compact"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as OwnKind)}
                >
                  {OWN_ACCOUNT_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {t(`kinds.${value}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}
        <Field
          label={t("settings.opening")}
          variant="compact"
          className="w-56"
          hint={t("settings.openingHint")}
          error={tried && !openingOk(opening) ? t("settings.openingRange") : undefined}
        >
          {(control) => (
            <Input
              {...control}
              variant="compact"
              inputMode="numeric"
              dir="ltr"
              className="text-end"
              value={opening}
              onChange={(event) => setOpening(event.target.value)}
            />
          )}
        </Field>
        {account && (
          <label className="flex min-h-11 items-center gap-2.5 self-center text-14 font-bold">
            <input
              type="checkbox"
              className="size-5 accent-navy"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            {t("settings.boxActive")}
          </label>
        )}
      </div>
      {account && account.active && !active && (
        <p className="rounded-chip bg-warn-bg px-3 py-2 text-13 font-bold text-warn-fg">
          {t("settings.boxOffWarning")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={edit.pending}>
          {account ? t("save") : t("settings.addBox")}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <p role="status" className="text-13 font-bold text-danger">
          {edit.error && tErrors(edit.error)}
        </p>
      </div>
    </form>
  );
}
