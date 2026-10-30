"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Money } from "@/components/admin/finance";
import { AmountField, ReadOnlyRecord, VoidForm } from "@/components/admin/finance-forms";
import type { BoxOption } from "@/components/admin/revenue-forms";
import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { adminRevenueHref } from "@/lib/admin/finance-query";
import type { ManualSale } from "@/lib/admin/revenue-queries";
import { formatDay, formatDayTime } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { formatPhone, normalizeIraqiMobile } from "@/lib/phone";
import {
  NOTE_MAX,
  parseAmount,
  SALE_NAME_MAX,
  SALE_PLACE_MAX,
  SALE_SERVICE_MAX,
} from "@/lib/schemas/finance";

import { saveManualSale, voidManualSale } from "../actions";

type CrewOption = { id: string; name: string; active: boolean };

/**
 * A18's manual sale drawer: work outside the app (phone bookings, hotels
 * and مواكب, outside Karbala). A new sale can be marked paid into a box in
 * the same step; an existing one is edited or voided (its payments with it).
 */
export function SaleForm({
  sale,
  boxes,
  crews,
  today,
  firstDay,
  closed = false,
  closeHref,
  listQuery,
}: {
  sale: ManualSale | null;
  boxes: BoxOption[];
  crews: CrewOption[];
  today: string;
  /** The first day a record may take: the start day, or the day after the last closed month. */
  firstDay: string;
  /** The record is dated in a closed month: shown, not edited. */
  closed?: boolean;
  closeHref: string;
  /** The list's month and size: a new sale opens there once saved, to take more payments. */
  listQuery: { month: string | undefined; n: number };
}) {
  const t = useTranslations("Admin.finance");
  const tErrors = useTranslations("Admin.editErrors");
  const router = useRouter();
  const edit = useAdminEdit();
  const [soldOn, setSoldOn] = useState(sale?.soldOn ?? today);
  const [customerName, setCustomerName] = useState(sale?.customerName ?? "");
  const [phone, setPhone] = useState(sale?.customerPhone ? formatPhone(sale.customerPhone) : "");
  const [service, setService] = useState(sale?.service ?? "");
  const [place, setPlace] = useState(sale?.place ?? "");
  const [amount, setAmount] = useState(sale ? formatIQD(sale.amountIqd) : "");
  const [crewId, setCrewId] = useState(sale?.crewId ?? "");
  const [note, setNote] = useState(sale?.note ?? "");
  const [paidInto, setPaidInto] = useState("");
  const [tried, setTried] = useState(false);

  if (sale && (sale.voidedAt || closed)) {
    return (
      <ReadOnlyRecord
        rows={[
          [t("sale.date"), formatDay(sale.soldOn)],
          [t("sale.customer"), sale.customerName],
          [t("sale.service"), sale.service],
          [t("amount"), <Money key="amount" amount={sale.amountIqd} />],
        ]}
        voidedAt={sale.voidedAt}
        voidedBy={sale.voidedBy}
        reason={sale.voidReason}
      />
    );
  }

  const typed = parseAmount(amount);
  const amountOk = typed !== null && typed >= 1;
  const nameOk = customerName.trim().length >= 2;
  const phoneOk = phone.trim() === "" || normalizeIraqiMobile(phone) !== null;
  const serviceOk = service.trim().length >= 2;
  const dayOk = soldOn >= firstDay && soldOn <= today;
  const valid = amountOk && nameOk && phoneOk && serviceOk && dayOk;
  const title = sale ? t("sale.editTitle") : t("sale.newTitle");

  return (
    <div className="flex flex-col gap-5">
      <form
        aria-label={title}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (!valid) return;
          edit.run(
            () =>
              saveManualSale({
                id: sale?.id ?? null,
                soldOn,
                customerName,
                customerPhone: phone,
                service,
                place,
                amountIqd: typed ?? 0,
                crewId: crewId === "" ? null : crewId,
                note,
                paidAccountId: !sale && paidInto !== "" ? paidInto : null,
              }),
            (result) => {
              if ("id" in result) {
                router.push(adminRevenueHref({ ...listQuery, sale: result.id }), { scroll: false });
              } else router.push(closeHref, { scroll: false });
            },
          );
        }}
      >
        <Field
          label={t("sale.date")}
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
              value={soldOn}
              onChange={(event) => setSoldOn(event.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("sale.customer")}
            variant="compact"
            error={tried && !nameOk ? t("nameRange", { max: SALE_NAME_MAX }) : undefined}
          >
            {(control) => (
              <Input
                {...control}
                variant="compact"
                maxLength={SALE_NAME_MAX}
                required
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
              />
            )}
          </Field>
          <Field
            label={t("sale.phone")}
            variant="compact"
            hint={t("sale.phoneHint")}
            error={tried && !phoneOk ? t("sale.phoneInvalid") : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="tel"
                inputMode="tel"
                dir="ltr"
                className="text-end"
                variant="compact"
                maxLength={20}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field
          label={t("sale.service")}
          variant="compact"
          hint={t("sale.serviceHint")}
          error={tried && !serviceOk ? t("sale.serviceRange") : undefined}
        >
          {(control) => (
            <Input
              {...control}
              variant="compact"
              maxLength={SALE_SERVICE_MAX}
              required
              value={service}
              onChange={(event) => setService(event.target.value)}
            />
          )}
        </Field>
        <Field label={t("sale.place")} variant="compact" hint={t("sale.placeHint")}>
          {(control) => (
            <Input
              {...control}
              variant="compact"
              maxLength={SALE_PLACE_MAX}
              value={place}
              onChange={(event) => setPlace(event.target.value)}
            />
          )}
        </Field>
        <AmountField value={amount} onChange={setAmount} showError={tried} />
        <Field label={t("sale.crew")} variant="compact">
          {(control) => (
            <Select
              {...control}
              variant="compact"
              value={crewId}
              onChange={(event) => setCrewId(event.target.value)}
            >
              <option value="">{t("sale.noCrew")}</option>
              {crews
                .filter((crew) => crew.active || crew.id === sale?.crewId)
                .map((crew) => (
                  <option key={crew.id} value={crew.id}>
                    {crew.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label={t("sale.note")} variant="compact" hint={t("noteHint")}>
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
        {!sale && (
          <Field label={t("sale.paidNow")} variant="compact" hint={t("sale.paidNowHint")}>
            {(control) => (
              <Select
                {...control}
                variant="compact"
                value={paidInto}
                onChange={(event) => setPaidInto(event.target.value)}
              >
                <option value="">{t("sale.notPaid")}</option>
                {boxes
                  .filter((box) => box.active)
                  .map((box) => (
                    <option key={box.id} value={box.id}>
                      {box.label}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
        {sale && (
          <p className="text-13 text-muted">
            {t("recordedBy", {
              name: sale.createdBy ?? t("unknownAdmin"),
              when: formatDayTime(sale.createdAt),
            })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={edit.pending}>
            {sale ? t("save") : t("sale.create")}
          </Button>
          <Button size="sm" variant="secondary" href={closeHref} scroll={false}>
            {t("cancel")}
          </Button>
          <p role="status" className="text-13 font-bold text-danger">
            {edit.error && tErrors(edit.error)}
          </p>
        </div>
      </form>
      {sale && (
        <VoidForm
          title={t("sale.voidTitle")}
          hint={t("sale.voidHint")}
          onVoid={(reason) => voidManualSale({ id: sale.id, reason })}
          closeHref={closeHref}
        />
      )}
    </div>
  );
}
