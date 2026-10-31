"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { Money } from "@/components/admin/finance";
import { AmountField, VoidForm } from "@/components/admin/finance-forms";
import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { AdminEditError } from "@/lib/admin/edit-errors";
import { adminPartnersHref } from "@/lib/admin/finance-query";
import type {
  OpeningEquipment,
  Partner,
  PartnerMovement,
  ShareSet,
} from "@/lib/admin/partner-queries";
import { cn } from "@/lib/cn";
import { formatDay, formatMonthYear } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { formatPhone, normalizeIraqiMobile, toWesternDigits } from "@/lib/phone";
import {
  AMOUNT_MAX,
  EQUIPMENT_NAME_MAX,
  formatShare,
  LIFE_MAX,
  NOTE_MAX,
  PARTNER_MOVEMENT_KINDS,
  PARTNER_NAME_MAX,
  type PartnerMovementKind,
  parseAmount,
  parseShare,
  SHARES_TOTAL,
} from "@/lib/schemas/finance";

import {
  saveEquipmentDisposal,
  saveOpeningEquipment,
  savePartner,
  savePartnerMovement,
  setPartnerShares,
  voidEquipmentDisposal,
  voidOpeningEquipment,
  voidPartnerMovement,
} from "../actions";

// A22's drawers (spec §8.3; Phase 7, task 5): a partner's details and their
// capital and withdrawals, the month's shares, opening equipment, and
// selling or writing off equipment. The database checks every rule again.

type BoxOption = { id: string; label: string; active: boolean };

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

function SavedLine({ shown, text }: { shown: boolean; text: string }) {
  return (
    <p role="status" className={cn("text-13 font-bold text-ok-fg", !shown && "sr-only")}>
      {shown && text}
    </p>
  );
}

/** Whole months, 1–240, typed in either digits. */
function parseMonths(text: string): number | null {
  const digits = toWesternDigits(text.trim());
  if (!/^\d{1,3}$/.test(digits)) return null;
  const months = Number(digits);
  return months >= 1 && months <= LIFE_MAX ? months : null;
}

/** The partner's details; a new partner opens their drawer once added. */
export function PartnerForm({
  partner,
  booksClosed,
  month,
  closeHref,
}: {
  partner: Partner | null;
  /** A month is closed: the opening capital holds. */
  booksClosed: boolean;
  month: string | undefined;
  closeHref: string;
}) {
  const t = useTranslations("Admin.finance");
  const router = useRouter();
  const edit = useAdminEdit();
  const [name, setName] = useState(partner?.name ?? "");
  const [phone, setPhone] = useState(partner?.phone ? formatPhone(partner.phone) : "");
  const [note, setNote] = useState(partner?.note ?? "");
  const [opening, setOpening] = useState(
    partner && partner.openingCapitalIqd !== 0 ? formatIQD(partner.openingCapitalIqd) : "0",
  );
  const [active, setActive] = useState(partner?.active ?? true);
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);

  const trimmed = name.trim();
  const nameOk = trimmed.length >= 2 && trimmed.length <= PARTNER_NAME_MAX;
  const phoneOk = phone.trim() === "" || normalizeIraqiMobile(phone) !== null;
  const openingAmount = parseAmount(opening);
  const openingOk = openingAmount !== null && Math.abs(openingAmount) <= AMOUNT_MAX;

  return (
    <form
      aria-label={partner ? t("partner.detailsTitle") : t("partner.newTitle")}
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        setSaved(false);
        if (!nameOk || !phoneOk || !openingOk) return;
        edit.run(
          () =>
            savePartner({
              id: partner?.id ?? null,
              name,
              phone,
              note,
              openingCapitalIqd: openingAmount,
              active,
            }),
          (result) => {
            if (partner) setSaved(true);
            else if ("id" in result)
              router.push(adminPartnersHref({ month, partner: result.id }), { scroll: false });
          },
        );
      }}
    >
      <Field
        label={t("partner.name")}
        variant="compact"
        error={tried && !nameOk ? t("partner.nameRange") : undefined}
      >
        {(control) => (
          <Input
            {...control}
            variant="compact"
            maxLength={PARTNER_NAME_MAX}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("partner.phone")}
          variant="compact"
          error={tried && !phoneOk ? t("partner.phoneInvalid") : undefined}
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
          label={t("partner.opening")}
          variant="compact"
          hint={booksClosed ? t("partner.openingLocked") : t("partner.openingHint")}
          error={tried && !openingOk ? t("partner.openingRange") : undefined}
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
      <Field label={t("partner.note")} variant="compact">
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
        <span className="text-14 font-bold">{t("partner.active")}</span>
      </Switch>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={edit.pending}>
          {partner ? t("save") : t("partner.create")}
        </Button>
        {!partner && (
          <Button size="sm" variant="secondary" href={closeHref} scroll={false}>
            {t("cancel")}
          </Button>
        )}
        <SavedLine shown={saved} text={t("partner.saved")} />
        <ErrorLine error={edit.error} />
      </div>
    </form>
  );
}

/** A partner's capital and withdrawals: the list, voiding one, and a new one. */
export function MovementSection({
  partnerId,
  movements,
  accounts,
  firstDay,
  today,
  closedThrough,
  closeHref,
}: {
  partnerId: string;
  movements: PartnerMovement[];
  accounts: BoxOption[];
  /** The first open day in the books. */
  firstDay: string;
  today: string;
  closedThrough: string | null;
  closeHref: string;
}) {
  const t = useTranslations("Admin.finance");
  const edit = useAdminEdit();
  const [movedOn, setMovedOn] = useState(today);
  const [kind, setKind] = useState<PartnerMovementKind>("capital");
  const [accountId, setAccountId] = useState(accounts.find((a) => a.active)?.id ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const amountIqd = parseAmount(amount);
  const amountOk = amountIqd !== null && amountIqd >= 1 && amountIqd <= AMOUNT_MAX;
  const dayOk = movedOn >= firstDay && movedOn <= today;
  const boxName = (id: string) => accounts.find((a) => a.id === id)?.label ?? "";

  return (
    <Section title={t("partner.movementsTitle")} hint={t("partner.movementsHint")}>
      {movements.length === 0 ? (
        <p className="text-14 text-body-2">{t("partner.noMovements")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider rounded-card border border-border bg-surface">
          {movements.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 px-3 py-2">
              <span className={cn("text-14", m.voidedAt && "text-muted line-through")}>
                <span className="font-bold">{formatDay(m.movedOn)}</span>{" "}
                {t(`partner.kinds.${m.kind}`)} ·{" "}
                <Money amount={m.kind === "withdrawal" ? -m.amountIqd : m.amountIqd} /> ·{" "}
                {boxName(m.accountId)}
                {m.note && <> · {m.note}</>}
                {m.voidedAt && <span className="sr-only"> {t("partner.voided")}</span>}
              </span>
              {m.voidedAt
                ? m.voidReason && <span className="text-12 text-muted">{m.voidReason}</span>
                : !(closedThrough && m.movedOn <= closedThrough) && (
                    <VoidForm
                      title={t("partner.voidMovement")}
                      hint={t("partner.voidMovementHint")}
                      onVoid={(reason) => voidPartnerMovement({ id: m.id, reason })}
                      closeHref={closeHref}
                    />
                  )}
            </li>
          ))}
        </ul>
      )}
      {firstDay <= today && (
        <form
          aria-label={t("partner.addMovement")}
          className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            setRecorded(false);
            if (!amountOk || !dayOk || !accountId || amountIqd === null) return;
            edit.run(
              () =>
                savePartnerMovement({
                  id: null,
                  partnerId,
                  movedOn,
                  kind,
                  accountId,
                  amountIqd,
                  note,
                }),
              () => {
                setAmount("");
                setNote("");
                setTried(false);
                setRecorded(true);
              },
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("partner.kind")} variant="compact">
              {(control) => (
                <Select
                  {...control}
                  variant="compact"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as PartnerMovementKind)}
                >
                  {PARTNER_MOVEMENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`partner.kinds.${k}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label={t("partner.date")}
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
                  value={movedOn}
                  onChange={(event) => setMovedOn(event.target.value)}
                />
              )}
            </Field>
            <Field
              label={t("partner.account")}
              variant="compact"
              error={tried && !accountId ? t("pickBox") : undefined}
            >
              {(control) => (
                <Select
                  {...control}
                  variant="compact"
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                >
                  <option value="" disabled>
                    {t("pickBox")}
                  </option>
                  {accounts
                    .filter((a) => a.active)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          </div>
          <AmountField value={amount} onChange={setAmount} showError={tried} />
          <Field label={t("partner.note")} variant="compact">
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
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" loading={edit.pending}>
              <Plus aria-hidden className="size-4" />
              {t("partner.addMovement")}
            </Button>
            <SavedLine shown={recorded} text={t("partner.recorded")} />
            <ErrorLine error={edit.error} />
          </div>
        </form>
      )}
    </Section>
  );
}

/** A month's shares: a percentage for each partner, 100% in all, or none. */
export function SharesForm({
  partners,
  names,
  sets,
  months,
  initialMonth,
  closedThrough,
}: {
  /** Switched-on partners: those a set may give a share. */
  partners: Pick<Partner, "id" | "name">[];
  /** Every partner's name, switched-off ones too, for the sets so far. */
  names: Record<string, string>;
  sets: ShareSet[];
  /** The months a set may start ("2026-10"): the books' first open month through this one. */
  months: string[];
  initialMonth: string;
  closedThrough: string | null;
}) {
  const t = useTranslations("Admin.finance");
  const edit = useAdminEdit();
  const router = useRouter();
  const inForce = (month: string) =>
    sets.find((set) => set.month <= month)?.shares ?? ([] as ShareSet["shares"]);
  const valuesFor = (month: string) =>
    Object.fromEntries(
      partners.map((p) => {
        const share = inForce(month).find((s) => s.partnerId === p.id);
        return [p.id, share ? formatShare(share.shareBp) : ""];
      }),
    );
  const [month, setMonth] = useState(initialMonth);
  const [values, setValues] = useState<Record<string, string>>(valuesFor(initialMonth));
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const nameOf = new Map(Object.entries(names));

  const parsed = partners.map((p) => {
    const text = (values[p.id] ?? "").trim();
    return { partnerId: p.id, text, bp: text === "" ? 0 : parseShare(text) };
  });
  const allValid = parsed.every((p) => p.bp !== null && p.bp <= SHARES_TOTAL);
  const total = parsed.reduce((sum, p) => sum + (p.bp ?? 0), 0);
  const empty = parsed.every((p) => p.text === "" || p.bp === 0);
  const totalOk = empty || total === SHARES_TOTAL;
  // An empty set removes the month's own; a month that only inherits one has nothing to remove.
  const ownSet = sets.some((set) => set.month === month);
  const nothingToRemove = empty && !ownSet;
  const closed = closedThrough !== null && `${month}-01` <= closedThrough;

  if (partners.length === 0) {
    return <p className="text-14 text-body-2">{t("shares.noPartners")}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        aria-label={t("shares.title")}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          setSaved(false);
          if (!allValid || !totalOk || closed || nothingToRemove) return;
          const shares = parsed
            .filter((p) => p.bp !== null && p.bp > 0)
            .map((p) => ({ partnerId: p.partnerId, shareBp: p.bp ?? 0 }));
          edit.run(
            () => setPartnerShares({ month, shares }),
            () => {
              setSaved(true);
              router.refresh();
            },
          );
        }}
      >
        <p className="text-13 text-body-2">{t("shares.hint")}</p>
        <Field label={t("shares.month")} variant="compact" className="sm:w-60">
          {(control) => (
            <Select
              {...control}
              variant="compact"
              value={month}
              onChange={(event) => {
                setMonth(event.target.value);
                setValues(valuesFor(event.target.value));
                setSaved(false);
              }}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonthYear(`${m}-15T12:00:00Z`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {closed && (
          <p className="rounded-chip bg-warn-bg px-3 py-2 text-14 font-bold text-warn-fg">
            {t("shares.closedMonth")}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {parsed.map((p) => (
            <Field
              key={p.partnerId}
              label={t("shares.shareOf", { name: nameOf.get(p.partnerId) ?? "" })}
              variant="compact"
              error={
                tried && (p.bp === null || p.bp > SHARES_TOTAL) ? t("shares.invalid") : undefined
              }
            >
              {(control) => (
                <Input
                  {...control}
                  variant="compact"
                  inputMode="decimal"
                  dir="ltr"
                  className="text-end"
                  maxLength={6}
                  disabled={closed}
                  value={values[p.partnerId] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [p.partnerId]: event.target.value }))
                  }
                />
              )}
            </Field>
          ))}
        </div>
        <p
          className={cn(
            "text-14 font-bold",
            allValid && totalOk ? "text-body-2" : tried ? "text-danger" : "text-body-2",
          )}
        >
          <span dir="ltr">{t("shares.total", { total: formatShare(total) })}</span>
          {tried && allValid && !totalOk && <> · {t("shares.totalWrong")}</>}
        </p>
        {tried && nothingToRemove && (
          <p className="text-14 font-bold text-danger">{t("shares.nothingToRemove")}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={edit.pending} disabled={closed}>
            {t("shares.save")}
          </Button>
          <SavedLine shown={saved} text={t("shares.saved")} />
          <ErrorLine error={edit.error} />
        </div>
      </form>
      <Section title={t("shares.historyTitle")}>
        {sets.length === 0 ? (
          <p className="text-14 text-body-2">{t("shares.none")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-divider rounded-card border border-border bg-surface">
            {sets.map((set) => (
              <li key={set.month} className="flex flex-col gap-1 px-3 py-2 text-14">
                <span className="font-bold">
                  {t("shares.fromMonth", { month: formatMonthYear(`${set.month}-15T12:00:00Z`) })}
                </span>
                <span className="text-body-2">
                  {set.shares
                    .map(
                      (s) =>
                        `${nameOf.get(s.partnerId) ?? ""} ${t("partners.share", { share: formatShare(s.shareBp) })}`,
                    )
                    .join("، ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** What the company owned at the books' start: add, edit, or void. */
export function OpeningEquipmentForm({
  item,
  booksClosed,
  closeHref,
}: {
  item: OpeningEquipment | null;
  booksClosed: boolean;
  closeHref: string;
}) {
  const t = useTranslations("Admin.finance");
  const router = useRouter();
  const edit = useAdminEdit();
  const [name, setName] = useState(item?.name ?? "");
  const [value, setValue] = useState(item ? formatIQD(item.valueIqd) : "");
  const [months, setMonths] = useState(item ? String(item.monthsLeft) : "");
  const [note, setNote] = useState(item?.note ?? "");
  const [tried, setTried] = useState(false);
  const trimmed = name.trim();
  const nameOk = trimmed.length >= 2 && trimmed.length <= EQUIPMENT_NAME_MAX;
  const valueIqd = parseAmount(value);
  const valueOk = valueIqd !== null && valueIqd >= 1 && valueIqd <= AMOUNT_MAX;
  const monthsLeft = parseMonths(months);

  if (booksClosed) {
    return (
      <p className="rounded-chip bg-warn-bg px-3 py-2 text-14 font-bold text-warn-fg">
        {t("equipment.locked")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        aria-label={item ? item.name : t("equipment.newTitle")}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (!nameOk || !valueOk || monthsLeft === null || valueIqd === null) return;
          edit.run(
            () => saveOpeningEquipment({ id: item?.id ?? null, name, valueIqd, monthsLeft, note }),
            () => router.push(closeHref, { scroll: false }),
          );
        }}
      >
        {!item && <p className="text-13 text-body-2">{t("equipment.newHint")}</p>}
        <Field
          label={t("equipment.name")}
          variant="compact"
          error={tried && !nameOk ? t("equipment.nameRange") : undefined}
        >
          {(control) => (
            <Input
              {...control}
              variant="compact"
              maxLength={EQUIPMENT_NAME_MAX}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("equipment.value")}
            variant="compact"
            error={tried && !valueOk ? t("amountRange") : undefined}
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
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </Field>
          <Field
            label={t("equipment.monthsLeft")}
            variant="compact"
            error={tried && monthsLeft === null ? t("equipment.monthsRange") : undefined}
          >
            {(control) => (
              <Input
                {...control}
                variant="compact"
                inputMode="numeric"
                dir="ltr"
                className="text-end"
                maxLength={3}
                required
                value={months}
                onChange={(event) => setMonths(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={t("equipment.note")} variant="compact">
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
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={edit.pending}>
            {item ? t("save") : t("equipment.create")}
          </Button>
          <Button size="sm" variant="secondary" href={closeHref} scroll={false}>
            {t("cancel")}
          </Button>
          <ErrorLine error={edit.error} />
        </div>
      </form>
      {item && (
        <VoidForm
          title={t("equipment.voidTitle")}
          hint={t("equipment.voidHint")}
          onVoid={(reason) => voidOpeningEquipment({ id: item.id, reason })}
          closeHref={closeHref}
        />
      )}
    </div>
  );
}

/** Selling or writing off an item, or its live disposal with a void. */
export function DisposalSection({
  item,
  disposal,
  accounts,
  firstDay,
  today,
  closedThrough,
  closeHref,
}: {
  item: { kind: "purchase" | "opening"; id: string; acquiredOn: string };
  disposal: {
    id: string;
    disposedOn: string;
    accountId: string | null;
    proceedsIqd: number;
    note: string | null;
  } | null;
  accounts: BoxOption[];
  firstDay: string;
  today: string;
  closedThrough: string | null;
  closeHref: string;
}) {
  const t = useTranslations("Admin.finance");
  const edit = useAdminEdit();
  const router = useRouter();
  const from = item.acquiredOn > firstDay ? item.acquiredOn : firstDay;
  const [disposedOn, setDisposedOn] = useState(today);
  const [proceeds, setProceeds] = useState("");
  const [accountId, setAccountId] = useState(accounts.find((a) => a.active)?.id ?? "");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const proceedsIqd = proceeds.trim() === "" ? 0 : parseAmount(proceeds);
  const proceedsOk = proceedsIqd !== null && proceedsIqd >= 0 && proceedsIqd <= AMOUNT_MAX;
  const dayOk = disposedOn >= from && disposedOn <= today;
  const accountOk = proceedsIqd === 0 || accountId !== "";

  if (disposal) {
    const closed = closedThrough !== null && disposal.disposedOn <= closedThrough;
    return (
      <Section title={t("equipment.disposeTitle")}>
        <p className="text-14">
          <span className="font-bold">
            {t("equipment.disposal", { date: formatDay(disposal.disposedOn) })}
          </span>
          {" · "}
          {disposal.proceedsIqd > 0 ? (
            <>
              {t("equipment.sold")} <Money amount={disposal.proceedsIqd} />
            </>
          ) : (
            t("equipment.writtenOff")
          )}
          {disposal.note && <> · {disposal.note}</>}
        </p>
        {closed ? (
          <p className="text-13 text-muted">{t("equipment.disposalClosed")}</p>
        ) : (
          <VoidForm
            title={t("equipment.voidDisposal")}
            hint={t("equipment.voidDisposalHint")}
            onVoid={(reason) => voidEquipmentDisposal({ id: disposal.id, reason })}
            closeHref={closeHref}
          />
        )}
      </Section>
    );
  }

  if (from > today) return null;
  return (
    <Section title={t("equipment.disposeTitle")} hint={t("equipment.disposeHint")}>
      <form
        aria-label={t("equipment.disposeTitle")}
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (!dayOk || !proceedsOk || !accountOk || proceedsIqd === null) return;
          edit.run(
            () =>
              saveEquipmentDisposal({
                expenseId: item.kind === "purchase" ? item.id : null,
                openingEquipmentId: item.kind === "opening" ? item.id : null,
                disposedOn,
                accountId: proceedsIqd > 0 ? accountId : null,
                proceedsIqd,
                note,
              }),
            () => router.refresh(),
          );
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("equipment.disposedOn")}
            variant="compact"
            error={
              tried && !dayOk
                ? t("dayRange", { from: formatDay(from), to: formatDay(today) })
                : undefined
            }
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                variant="compact"
                min={from}
                max={today}
                value={disposedOn}
                onChange={(event) => setDisposedOn(event.target.value)}
              />
            )}
          </Field>
          <Field
            label={t("equipment.proceeds")}
            variant="compact"
            hint={t("equipment.proceedsHint")}
            error={tried && !proceedsOk ? t("equipment.proceedsRange") : undefined}
          >
            {(control) => (
              <Input
                {...control}
                variant="compact"
                inputMode="numeric"
                dir="ltr"
                className="text-end"
                value={proceeds}
                onChange={(event) => setProceeds(event.target.value)}
              />
            )}
          </Field>
        </div>
        {proceedsIqd !== null && proceedsIqd > 0 && (
          <Field
            label={t("equipment.account")}
            variant="compact"
            error={tried && !accountOk ? t("pickBox") : undefined}
          >
            {(control) => (
              <Select
                {...control}
                variant="compact"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                <option value="" disabled>
                  {t("pickBox")}
                </option>
                {accounts
                  .filter((a) => a.active)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={t("equipment.note")} variant="compact">
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
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={edit.pending}>
            {t("equipment.dispose")}
          </Button>
          <ErrorLine error={edit.error} />
        </div>
      </form>
    </Section>
  );
}
