"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { Money } from "@/components/admin/finance";
import { AmountField, VoidForm } from "@/components/admin/finance-forms";
import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, ChipGroup } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { AdminEditError } from "@/lib/admin/edit-errors";
import { adminPayrollHref } from "@/lib/admin/finance-query";
import type {
  Membership,
  PayrollAdjustment,
  Worker,
  WorkerRate,
} from "@/lib/admin/payroll-queries";
import { cn } from "@/lib/cn";
import { formatDay, formatMonthYear } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { formatPhone, normalizeIraqiMobile } from "@/lib/phone";
import {
  AMOUNT_MAX,
  NOTE_MAX,
  PAYROLL_ADJUSTMENT_KINDS,
  type PayrollAdjustmentKind,
  parseAmount,
  WORKER_NAME_MAX,
  WORKER_PAY_TYPES,
  type WorkerPayType,
} from "@/lib/schemas/finance";

import {
  deleteWorkerCrew,
  moveWorker,
  savePayrollAdjustment,
  saveWorker,
  saveWorkerRate,
  setWorkerDays,
  voidPayrollAdjustment,
  voidWorkerRate,
} from "../actions";

// A21's worker drawer (spec §8.3; Phase 7, task 4): the worker's details,
// crew moves, rates, the month's bonuses and deductions, and days worked.
// The database checks every rule again (the day, closed months, overlaps).

/** One part of the drawer, under its heading. */
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-16 font-extrabold">{title}</h3>
      {hint && <p className="text-13 text-body-2">{hint}</p>}
      {children}
    </section>
  );
}

function ErrorLine({ error }: { error: AdminEditError | null }) {
  const tErrors = useTranslations("Admin.editErrors");
  return (
    <p role="status" className="text-13 font-bold text-danger">
      {error && tErrors(error)}
    </p>
  );
}

/** The worker's details; a new worker opens their drawer once added. */
export function WorkerForm({
  worker,
  booksClosed,
  month,
  closeHref,
}: {
  worker: Worker | null;
  /** A month is closed: the opening balance holds. */
  booksClosed: boolean;
  /** The page's `?month=`, kept when a new worker's drawer opens. */
  month: string | undefined;
  closeHref: string;
}) {
  const t = useTranslations("Admin.finance");
  const router = useRouter();
  const edit = useAdminEdit();
  const [name, setName] = useState(worker?.name ?? "");
  const [phone, setPhone] = useState(worker?.phone ? formatPhone(worker.phone) : "");
  const [note, setNote] = useState(worker?.note ?? "");
  const [opening, setOpening] = useState(
    worker ? (worker.openingBalanceIqd === 0 ? "0" : formatIQD(worker.openingBalanceIqd)) : "0",
  );
  const [active, setActive] = useState(worker?.active ?? true);
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);

  const trimmed = name.trim();
  const nameOk = trimmed.length >= 2 && trimmed.length <= WORKER_NAME_MAX;
  const phoneOk = phone.trim() === "" || normalizeIraqiMobile(phone) !== null;
  const openingAmount = parseAmount(opening);
  const openingOk = openingAmount !== null && Math.abs(openingAmount) <= AMOUNT_MAX;

  return (
    <form
      aria-label={worker ? t("worker.detailsTitle") : t("worker.newTitle")}
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        setSaved(false);
        if (!nameOk || !phoneOk || !openingOk) return;
        edit.run(
          () =>
            saveWorker({
              id: worker?.id ?? null,
              name,
              phone,
              note,
              openingBalanceIqd: openingAmount,
              active,
            }),
          (result) => {
            if (worker) setSaved(true);
            else if ("id" in result)
              router.push(adminPayrollHref({ month, worker: result.id }), { scroll: false });
          },
        );
      }}
    >
      <Field
        label={t("worker.name")}
        variant="compact"
        error={tried && !nameOk ? t("worker.nameRange") : undefined}
      >
        {(control) => (
          <Input
            {...control}
            variant="compact"
            maxLength={WORKER_NAME_MAX}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("worker.phone")}
          variant="compact"
          error={tried && !phoneOk ? t("worker.phoneInvalid") : undefined}
        >
          {(control) => (
            <Input
              {...control}
              type="tel"
              variant="compact"
              dir="ltr"
              className="text-end"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("worker.opening")}
          variant="compact"
          hint={booksClosed ? t("worker.openingLocked") : t("worker.openingHint")}
          error={tried && !openingOk ? t("worker.openingRange") : undefined}
        >
          {(control) => (
            <Input
              {...control}
              variant="compact"
              inputMode="numeric"
              dir="ltr"
              className="text-end"
              disabled={booksClosed}
              value={opening}
              onChange={(event) => setOpening(event.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label={t("worker.note")} variant="compact">
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
      <Switch checked={active} onChange={(event) => setActive(event.target.checked)}>
        <span className="text-14 font-bold">{t("worker.active")}</span>
      </Switch>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={edit.pending}>
          {worker ? t("save") : t("worker.create")}
        </Button>
        {!worker && (
          <Button size="sm" variant="secondary" href={closeHref} scroll={false}>
            {t("cancel")}
          </Button>
        )}
        <p role="status" className={cn("text-13 font-bold text-ok-fg", !saved && "sr-only")}>
          {saved && t("worker.saved")}
        </p>
        <ErrorLine error={edit.error} />
      </div>
    </form>
  );
}

/** The worker's crew now, a move to another (or none), and the moves so far. */
export function CrewSection({
  workerId,
  memberships,
  crews,
  today,
}: {
  workerId: string;
  memberships: Membership[];
  crews: { id: string; name: string; active: boolean }[];
  today: string;
}) {
  const t = useTranslations("Admin.finance");
  const edit = useAdminEdit();
  const current = memberships.find((m) => m.toOn === null) ?? null;
  // "" = pick one, "none" = leaves crews.
  const [crew, setCrew] = useState("");
  const [on, setOn] = useState(today);
  const [tried, setTried] = useState(false);
  const crewOk = crew !== "" && crew !== (current?.crewId ?? "none");
  const dayOk = on !== "" && on <= today && (!current || on > current.fromOn);

  return (
    <Section title={t("worker.crewTitle")}>
      <p className="text-15 font-bold">
        {current ? t("worker.currentCrew", { crew: current.crewName }) : t("worker.noCurrentCrew")}
      </p>
      <form
        aria-label={t("worker.move")}
        className="flex flex-wrap items-end gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (!crewOk || !dayOk) return;
          edit.run(
            () => moveWorker({ workerId, crewId: crew === "none" ? null : crew, on }),
            () => {
              setCrew("");
              setTried(false);
            },
          );
        }}
      >
        <Field
          label={t("worker.moveTo")}
          variant="compact"
          className="w-48"
          error={tried && !crewOk ? t("worker.pickCrew") : undefined}
        >
          {(control) => (
            <Select
              {...control}
              variant="compact"
              value={crew}
              onChange={(event) => setCrew(event.target.value)}
            >
              <option value="" disabled>
                {t("worker.pickCrew")}
              </option>
              {crews
                .filter((c) => c.active && c.id !== current?.crewId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              {current && <option value="none">{t("worker.leaveCrews")}</option>}
            </Select>
          )}
        </Field>
        <Field
          label={t("worker.moveOn")}
          variant="compact"
          className="w-44"
          error={
            tried && !dayOk
              ? t("dayRange", { from: formatDay(current?.fromOn ?? today), to: formatDay(today) })
              : undefined
          }
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              variant="compact"
              max={today}
              value={on}
              onChange={(event) => setOn(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="sm" loading={edit.pending}>
          {t("worker.move")}
        </Button>
      </form>
      <ErrorLine error={edit.error} />
      <h4 className="text-14 font-bold text-muted">{t("worker.history")}</h4>
      {memberships.length === 0 ? (
        <p className="text-14 text-body-2">{t("worker.noHistory")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider rounded-card border border-border bg-surface">
          {memberships.map((m) => (
            <MembershipRow key={m.id} membership={m} />
          ))}
        </ul>
      )}
      <p className="text-12 text-muted">{t("worker.deleteMembershipHint")}</p>
    </Section>
  );
}

function MembershipRow({ membership }: { membership: Membership }) {
  const t = useTranslations("Admin.finance");
  const edit = useAdminEdit();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
      <span className="text-14">
        <span className="font-bold">{membership.crewName}</span>{" "}
        {t("worker.range", {
          from: formatDay(membership.fromOn),
          to: membership.toOn ? formatDay(membership.toOn) : t("worker.untilNow"),
        })}
      </span>
      <span className="flex items-center gap-2">
        <ErrorLine error={edit.error} />
        <Button
          size="sm"
          variant="secondary"
          loading={edit.pending}
          aria-label={t("worker.deleteMembershipLabel", {
            crew: membership.crewName,
            from: formatDay(membership.fromOn),
          })}
          onClick={() =>
            edit.run(
              () => deleteWorkerCrew(membership.id),
              () => undefined,
            )
          }
        >
          <Trash2 aria-hidden className="size-4" />
          {t("worker.deleteMembership")}
        </Button>
      </span>
    </li>
  );
}

/** The worker's rates, newest first, a new one from a day, and voiding one. */
export function RateSection({
  workerId,
  rates,
  closedThrough,
  today,
  closeHref,
}: {
  workerId: string;
  rates: WorkerRate[];
  /** The last closed day: a rate from it or before stays (ZL054). */
  closedThrough: string | null;
  today: string;
  /** The drawer itself: voiding refreshes it. */
  closeHref: string;
}) {
  const t = useTranslations("Admin.finance");
  const tErrors = useTranslations("Admin.editErrors");
  const edit = useAdminEdit();
  const [effectiveOn, setEffectiveOn] = useState(today);
  const [payType, setPayType] = useState<WorkerPayType>("per_visit");
  const [amount, setAmount] = useState("");
  const [tried, setTried] = useState(false);
  const amountIqd = payType === "none" ? 0 : parseAmount(amount);
  const amountOk =
    payType === "none" || (amountIqd !== null && amountIqd >= 1 && amountIqd <= AMOUNT_MAX);
  const dayOk = effectiveOn !== "" && effectiveOn <= today;

  return (
    <Section title={t("worker.ratesTitle")} hint={t("worker.ratesHint")}>
      {rates.length === 0 ? (
        <p className="text-14 text-body-2">{t("worker.noRates")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider rounded-card border border-border bg-surface">
          {rates.map((rate) => (
            <li key={rate.id} className="flex flex-col gap-2 px-3 py-2">
              <span className={cn("text-14", rate.voidedAt && "text-muted line-through")}>
                <span className="font-bold">{formatDay(rate.effectiveOn)}</span>{" "}
                {t(`payroll.payTypes.${rate.payType}`)}
                {rate.payType !== "none" && (
                  <>
                    {" · "}
                    <Money amount={rate.amountIqd} />
                  </>
                )}
                {rate.voidedAt && <span className="sr-only"> {t("worker.voided")}</span>}
              </span>
              {rate.voidedAt ? (
                rate.voidReason && <span className="text-12 text-muted">{rate.voidReason}</span>
              ) : closedThrough !== null && rate.effectiveOn <= closedThrough ? null : (
                <VoidForm
                  title={t("worker.voidRate")}
                  hint={t("worker.voidRateHint")}
                  onVoid={(reason) => voidWorkerRate({ id: rate.id, reason })}
                  closeHref={closeHref}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        aria-label={t("worker.addRate")}
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (!amountOk || !dayOk || amountIqd === null) return;
          edit.run(
            () => saveWorkerRate({ workerId, effectiveOn, payType, amountIqd }),
            () => {
              setAmount("");
              setTried(false);
            },
          );
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("worker.rateFrom")}
            variant="compact"
            error={tried && !dayOk ? tErrors("date_in_future") : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                variant="compact"
                max={today}
                value={effectiveOn}
                onChange={(event) => setEffectiveOn(event.target.value)}
              />
            )}
          </Field>
          <Field label={t("worker.rateType")} variant="compact">
            {(control) => (
              <Select
                {...control}
                variant="compact"
                value={payType}
                onChange={(event) => setPayType(event.target.value as WorkerPayType)}
              >
                {WORKER_PAY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`payroll.payTypes.${type}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {payType !== "none" && (
          <AmountField value={amount} onChange={setAmount} showError={tried} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={edit.pending}>
            <Plus aria-hidden className="size-4" />
            {t("worker.addRate")}
          </Button>
          <ErrorLine error={edit.error} />
        </div>
      </form>
    </Section>
  );
}

/** The month's bonuses and deductions, a new one, and voiding one. */
export function AdjustmentSection({
  workerId,
  adjustments,
  firstDay,
  lastDay,
  closed,
  closeHref,
}: {
  workerId: string;
  adjustments: PayrollAdjustment[];
  /** The days a new one may take in this month (open, in the books, not after today). */
  firstDay: string;
  lastDay: string;
  closed: boolean;
  closeHref: string;
}) {
  const t = useTranslations("Admin.finance");
  const edit = useAdminEdit();
  const [adjustedOn, setAdjustedOn] = useState(lastDay);
  const [kind, setKind] = useState<PayrollAdjustmentKind>("bonus");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const amountIqd = parseAmount(amount);
  const amountOk = amountIqd !== null && amountIqd >= 1 && amountIqd <= AMOUNT_MAX;
  const reasonOk = reason.trim().length > 0;
  const dayOk = adjustedOn >= firstDay && adjustedOn <= lastDay;
  const canAdd = !closed && firstDay <= lastDay;

  return (
    <Section title={t("worker.adjustmentsTitle")}>
      {adjustments.length === 0 ? (
        <p className="text-14 text-body-2">{t("worker.noAdjustments")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider rounded-card border border-border bg-surface">
          {adjustments.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 px-3 py-2">
              <span className={cn("text-14", a.voidedAt && "text-muted line-through")}>
                <span className="font-bold">{formatDay(a.adjustedOn)}</span>{" "}
                {t(`worker.adjustmentKinds.${a.kind}`)} ·{" "}
                <Money amount={a.kind === "deduction" ? -a.amountIqd : a.amountIqd} /> · {a.reason}
                {a.voidedAt && <span className="sr-only"> {t("worker.voided")}</span>}
              </span>
              {!a.voidedAt && !closed && (
                <VoidForm
                  title={t("worker.voidAdjustment")}
                  hint={t("worker.voidAdjustmentHint")}
                  onVoid={(text) => voidPayrollAdjustment({ id: a.id, reason: text })}
                  closeHref={closeHref}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <form
          aria-label={t("worker.adjustmentsTitle")}
          className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if (!amountOk || !reasonOk || !dayOk || amountIqd === null) return;
            edit.run(
              () => savePayrollAdjustment({ workerId, adjustedOn, kind, amountIqd, reason }),
              () => {
                setAmount("");
                setReason("");
                setTried(false);
              },
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("worker.adjustmentKind")} variant="compact">
              {(control) => (
                <Select
                  {...control}
                  variant="compact"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as PayrollAdjustmentKind)}
                >
                  {PAYROLL_ADJUSTMENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`worker.adjustmentKinds.${k}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label={t("worker.adjustmentDay")}
              variant="compact"
              error={
                tried && !dayOk
                  ? t("dayRange", { from: formatDay(firstDay), to: formatDay(lastDay) })
                  : undefined
              }
            >
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  variant="compact"
                  min={firstDay}
                  max={lastDay}
                  value={adjustedOn}
                  onChange={(event) => setAdjustedOn(event.target.value)}
                />
              )}
            </Field>
          </div>
          <AmountField value={amount} onChange={setAmount} showError={tried} />
          <Field
            label={t("worker.adjustmentReason")}
            variant="compact"
            error={tried && !reasonOk ? t("voidReason") : undefined}
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
              <Plus aria-hidden className="size-4" />
              {t("worker.addAdjustment")}
            </Button>
            <ErrorLine error={edit.error} />
          </div>
        </form>
      )}
    </Section>
  );
}

/** The month's days worked as day chips; the crew's work days fill them at once. */
export function DaysSection({
  workerId,
  month,
  days,
  crewDays,
  firstDay,
  lastDay,
  closed,
}: {
  workerId: string;
  /** "2026-10" */
  month: string;
  days: string[];
  crewDays: string[];
  firstDay: string;
  lastDay: string;
  closed: boolean;
}) {
  const t = useTranslations("Admin.finance");
  const edit = useAdminEdit();
  const [ticked, setTicked] = useState<string[]>(days);
  const length = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  const all = Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const open = (day: string) => !closed && day >= firstDay && day <= lastDay;

  return (
    <Section title={t("worker.daysTitle")} hint={t("worker.daysHint")}>
      <form
        aria-label={t("worker.daysTitle")}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          edit.run(
            () => setWorkerDays({ workerId, month, days: [...ticked].sort() }),
            () => undefined,
          );
        }}
      >
        <ChipGroup
          legend={t("worker.daysLegend", { month: formatMonthYear(`${month}-15T12:00:00Z`) })}
          legendClassName="text-14 font-bold"
        >
          {all.map((day) => (
            <Chip
              key={day}
              type="checkbox"
              variant="tag"
              className="min-w-11"
              name="days"
              value={day}
              disabled={!open(day) && !ticked.includes(day)}
              checked={ticked.includes(day)}
              onChange={(event) => {
                if (!open(day)) return;
                setTicked(
                  event.target.checked ? [...ticked, day] : ticked.filter((d) => d !== day),
                );
              }}
            >
              <span aria-hidden>{Number(day.slice(8))}</span>
              <span className="sr-only">{formatDay(day)}</span>
            </Chip>
          ))}
        </ChipGroup>
        <p className="text-14 font-bold" role="status">
          {t("worker.daysCount", { count: ticked.length })}
        </p>
        {!closed && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" loading={edit.pending}>
              {t("worker.saveDays")}
            </Button>
            {crewDays.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setTicked([...new Set([...ticked, ...crewDays.filter(open)])].sort())
                }
              >
                {t("worker.fillCrewDays")}
              </Button>
            )}
            <ErrorLine error={edit.error} />
          </div>
        )}
      </form>
    </Section>
  );
}

/** The month's figures for one worker, with "ادفع له". */
export function WorkerSummary({ rows, pay }: { rows: [string, number][]; pay: ReactNode }) {
  const t = useTranslations("Admin.finance");
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="text-16 font-extrabold">{t("worker.summaryTitle")}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        {rows.map(([label, amount]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-13 text-muted">{label}</dt>
            <dd className="text-15 font-bold">
              <Money amount={amount} />
            </dd>
          </div>
        ))}
      </dl>
      {pay}
    </Card>
  );
}
