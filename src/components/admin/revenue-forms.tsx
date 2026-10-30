"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { savePayment, saveDiscount, voidDiscount, voidPayment } from "@/app/admin/finance/actions";
import { Money } from "@/components/admin/finance";
import { AmountField, VoidForm } from "@/components/admin/finance-forms";
import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { formatDay, formatDayTime } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { discountSchema, NOTE_MAX, parseAmount, paymentSchema } from "@/lib/schemas/finance";

// The revenue forms (spec §8.3 "Revenue and debts"; Phase 7, task 2): a
// payment or refund and a discount, in the item's "الحساب" card (A2, A7,
// a manual sale) and in A18's payment drawer. The database checks again.

export type BoxOption = { id: string; label: string; active: boolean };

/** The item a payment or discount is for: exactly one id. */
export type RevenueTarget = {
  orderId: string | null;
  subscriptionId: string | null;
  saleId: string | null;
};

type Done = { closeHref: string } | { onDone: () => void };

function useFinish(done: Done) {
  const router = useRouter();
  return () => {
    if ("closeHref" in done) router.push(done.closeHref, { scroll: false });
    else done.onDone();
  };
}

/**
 * A payment (money in) or, with `refund`, a refund (money back out, stored
 * negative). An existing payment is edited here and voided below it.
 */
export function PaymentForm({
  target,
  payment,
  refund,
  defaultAmount,
  boxes,
  today,
  startOn,
  done,
}: {
  target: RevenueTarget;
  payment: {
    id: string;
    paidOn: string;
    accountId: string;
    amountIqd: number;
    automatic: boolean;
    note: string | null;
    createdAt: string;
    createdBy: string | null;
  } | null;
  refund: boolean;
  /** Prefilled for a new one: what is still owed, or what can go back. */
  defaultAmount: number | null;
  boxes: BoxOption[];
  today: string;
  startOn: string;
  done: Done;
}) {
  const t = useTranslations("Admin.finance");
  const tErrors = useTranslations("Admin.editErrors");
  const finish = useFinish(done);
  const edit = useAdminEdit();
  const negative = payment ? payment.amountIqd < 0 : refund;
  const [paidOn, setPaidOn] = useState(payment?.paidOn ?? today);
  const [accountId, setAccountId] = useState(
    payment?.accountId ?? boxes.find((box) => box.active)?.id ?? "",
  );
  const shown = payment ? Math.abs(payment.amountIqd) : defaultAmount;
  const [amount, setAmount] = useState(shown && shown > 0 ? formatIQD(shown) : "");
  const [note, setNote] = useState(payment?.note ?? "");
  const [tried, setTried] = useState(false);

  const typed = parseAmount(amount) ?? 0;
  const input = {
    id: payment?.id ?? null,
    ...(payment ? { orderId: null, subscriptionId: null, saleId: null } : target),
    paidOn,
    accountId,
    amountIqd: negative ? -typed : typed,
    note,
  };
  const valid = typed > 0 && paymentSchema.safeParse(input).success;
  const dayOk = paidOn >= startOn && paidOn <= today;
  const title = payment
    ? negative
      ? t("payment.editRefundTitle")
      : t("payment.editTitle")
    : negative
      ? t("payment.refundTitle")
      : t("payment.newTitle");

  return (
    <div className="flex flex-col gap-4">
      <form
        aria-label={title}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (!valid || !dayOk) return;
          edit.run(() => savePayment(input), finish);
        }}
      >
        {payment?.automatic && (
          <p className="rounded-chip bg-well px-3 py-2 text-14 text-body-2">
            {t("payment.automaticHint")}
          </p>
        )}
        <Field
          label={t("payment.date")}
          variant="compact"
          error={
            tried && !dayOk
              ? t("dayRange", { from: formatDay(startOn), to: formatDay(today) })
              : undefined
          }
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              variant="compact"
              min={startOn}
              max={today}
              required
              value={paidOn}
              onChange={(event) => setPaidOn(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={negative ? t("payment.refundAccount") : t("payment.account")}
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
              {boxes
                .filter((box) => box.active || box.id === payment?.accountId)
                .map((box) => (
                  <option key={box.id} value={box.id}>
                    {box.label}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <AmountField value={amount} onChange={setAmount} showError={tried} />
        <Field label={t("payment.note")} variant="compact" hint={t("noteHint")}>
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
        {payment && (
          <p className="text-13 text-muted">
            {t("recordedBy", {
              name:
                payment.createdBy ?? (payment.automatic ? t("payment.theCrew") : t("unknownAdmin")),
              when: formatDayTime(payment.createdAt),
            })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={edit.pending}>
            {payment ? t("save") : negative ? t("payment.createRefund") : t("payment.create")}
          </Button>
          {"closeHref" in done ? (
            <Button size="sm" variant="secondary" href={done.closeHref} scroll={false}>
              {t("cancel")}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={done.onDone}>
              {t("cancel")}
            </Button>
          )}
          <p role="status" className="text-13 font-bold text-danger">
            {edit.error && tErrors(edit.error)}
          </p>
        </div>
      </form>
      {payment && "closeHref" in done && (
        <VoidForm
          title={t("payment.voidTitle")}
          hint={t("payment.voidHint")}
          onVoid={(reason) => voidPayment({ id: payment.id, reason })}
          closeHref={done.closeHref}
        />
      )}
    </div>
  );
}

/** A discount on an order or a subscription, in the books only; edited or voided. */
export function DiscountForm({
  target,
  discount,
  maxAmount,
  onDone,
}: {
  target: Omit<RevenueTarget, "saleId">;
  discount: { id: string; amountIqd: number; reason: string | null } | null;
  /** The item's amount: a discount is at most that. */
  maxAmount: number;
  onDone: () => void;
}) {
  const t = useTranslations("Admin.finance");
  const tErrors = useTranslations("Admin.editErrors");
  const edit = useAdminEdit();
  const voiding = useAdminEdit();
  const [amount, setAmount] = useState(discount ? formatIQD(discount.amountIqd) : "");
  const [reason, setReason] = useState(discount?.reason ?? "");
  const [voidReason, setVoidReason] = useState("");
  const [tried, setTried] = useState(false);

  const typed = parseAmount(amount) ?? 0;
  const input = {
    id: discount?.id ?? null,
    ...(discount ? { orderId: null, subscriptionId: null } : target),
    amountIqd: typed,
    reason,
  };
  const amountOk = typed >= 1 && typed <= maxAmount;
  const valid = amountOk && discountSchema.safeParse(input).success;
  const title = discount ? t("discount.editTitle") : t("discount.newTitle");

  return (
    <div className="flex flex-col gap-4">
      <form
        aria-label={title}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (!valid) return;
          edit.run(() => saveDiscount(input), onDone);
        }}
      >
        <p className="text-13 text-body-2">{t("discount.hint")}</p>
        <Field
          label={t("amount")}
          variant="compact"
          hint={t("discount.max", { amount: formatIQD(maxAmount) })}
          error={
            tried && !amountOk ? t("discount.range", { amount: formatIQD(maxAmount) }) : undefined
          }
        >
          {(control) => (
            <Input
              {...control}
              variant="compact"
              inputMode="numeric"
              dir="ltr"
              className="text-end"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("discount.reason")}
          variant="compact"
          error={tried && reason.trim() === "" ? tErrors("reason_required") : undefined}
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
            {discount ? t("save") : t("discount.create")}
          </Button>
          <Button size="sm" variant="secondary" onClick={onDone}>
            {t("cancel")}
          </Button>
          <p role="status" className="text-13 font-bold text-danger">
            {edit.error && tErrors(edit.error)}
          </p>
        </div>
      </form>
      {discount && (
        <form
          aria-label={t("discount.voidTitle")}
          className="flex flex-col gap-3 border-t border-divider pt-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (voidReason.trim() === "") return;
            voiding.run(() => voidDiscount({ id: discount.id, reason: voidReason }), onDone);
          }}
        >
          <Field label={t("voidReason")} variant="compact">
            {(control) => (
              <Input
                {...control}
                variant="compact"
                maxLength={NOTE_MAX}
                value={voidReason}
                onChange={(event) => setVoidReason(event.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              loading={voiding.pending}
              disabled={voidReason.trim() === ""}
            >
              {t("discount.voidTitle")}
            </Button>
            <p role="status" className="text-13 font-bold text-danger">
              {voiding.error && tErrors(voiding.error)}
            </p>
          </div>
        </form>
      )}
    </div>
  );
}

/** "سجّل دفعة" / "استرجاع" / "خصم" under an item's account, each opening its form in place. */
export function ItemAccountActions({
  target,
  canPay,
  owed,
  paid,
  discount,
  discountMax,
  boxes,
  today,
  startOn,
}: {
  target: RevenueTarget;
  canPay: boolean;
  /** What is still owed (above 0), to prefill a payment. */
  owed: number;
  /** The live payments' total: at most this goes back. */
  paid: number;
  discount: { id: string; amountIqd: number; reason: string | null } | null;
  /** The item's amount when it can take a discount; null when it can't. */
  discountMax: number | null;
  boxes: BoxOption[];
  today: string;
  startOn: string;
}) {
  const t = useTranslations("Admin.finance");
  const [open, setOpen] = useState<"payment" | "refund" | "discount" | null>(null);
  const close = () => setOpen(null);

  if (open === "payment" || open === "refund") {
    return (
      <div className="rounded-card border border-border bg-surface p-4">
        <PaymentForm
          target={target}
          payment={null}
          refund={open === "refund"}
          defaultAmount={open === "refund" ? paid : owed > 0 ? owed : null}
          boxes={boxes}
          today={today}
          startOn={startOn}
          done={{ onDone: close }}
        />
      </div>
    );
  }
  if (open === "discount" && discountMax !== null) {
    return (
      <div className="rounded-card border border-border bg-surface p-4">
        <DiscountForm
          target={{ orderId: target.orderId, subscriptionId: target.subscriptionId }}
          discount={discount}
          maxAmount={discountMax}
          onDone={close}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {canPay && (
        <Button size="sm" onClick={() => setOpen("payment")}>
          {t("payment.new")}
        </Button>
      )}
      {paid > 0 && (
        <Button size="sm" variant="secondary" onClick={() => setOpen("refund")}>
          {t("payment.refund")}
        </Button>
      )}
      {discountMax !== null && (
        <Button size="sm" variant="secondary" onClick={() => setOpen("discount")}>
          {discount ? t("discount.edit") : t("discount.new")}
        </Button>
      )}
      {discount && (
        <span className="flex min-h-11 items-center text-13 text-muted">
          {t("discount.current")} <Money amount={discount.amountIqd} className="ms-1 font-bold" />
        </span>
      )}
    </div>
  );
}
