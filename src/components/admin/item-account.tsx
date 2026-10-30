import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { accountName, Money } from "@/components/admin/finance";
import { ItemAccountActions } from "@/components/admin/revenue-forms";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { financeAccounts, financeStartOn } from "@/lib/admin/finance-queries";
import { adminRevenueHref } from "@/lib/admin/finance-query";
import { itemAccount, type ItemRef } from "@/lib/admin/revenue-queries";
import { baghdadToday, formatDay } from "@/lib/dates";

/**
 * "الحساب" (spec §8.3 "Revenue and debts"): an order's, subscription's or
 * manual sale's amount in the books, its discount, every payment (the
 * crew's automatic one marked, voided ones struck out, each opening A18's
 * payment drawer) and what is owed or held as credit, with "سجّل دفعة",
 * "استرجاع" and "خصم". A2's order drawer, A7's subscription drawer and
 * A18's sale drawer show it.
 */
export async function ItemAccountCard({ item }: { item: ItemRef }) {
  const t = await getTranslations("Admin.finance");
  const [account, boxes, startOn] = await Promise.all([
    itemAccount(item),
    financeAccounts(),
    financeStartOn(),
  ]);
  const { order } = account;
  // A covered order is paid through its subscription.
  if (order?.covered) {
    return (
      <Card className="flex flex-col gap-2 p-4">
        <h2 className="text-16 font-extrabold">{t("account.title")}</h2>
        <p className="text-14 text-body-2">{t("account.covered")}</p>
      </Card>
    );
  }
  const { receivable, payments, discount } = account;
  // A cancelled order or a no-show with no money on it has no account.
  if ((order?.status === "cancelled" || order?.status === "no_show") && payments.length === 0) {
    return null;
  }
  const boxName = new Map(
    boxes.map((box) => [box.id, accountName(box, (crew) => t("crewBox", { crew }))]),
  );
  const counted = receivable?.counted ?? false;
  // An order completed before the books (no row, or one held only by payments).
  const beforeBooks =
    (item.kind === "order" && order?.status === "completed" && !counted) ||
    (item.kind === "subscription" && !counted);
  const canPay = !beforeBooks;
  const balance = receivable?.balanceIqd ?? 0;
  const paid = receivable?.paidIqd ?? 0;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-16 font-extrabold">{t("account.title")}</h2>
      {!counted && (
        <p className="text-14 text-body-2">
          {beforeBooks
            ? item.kind === "subscription"
              ? t("account.subscriptionBeforeBooks")
              : t("account.beforeBooks")
            : t("account.notYet")}
        </p>
      )}
      {(counted || paid !== 0) && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-14">
          {counted && receivable && (
            <>
              <dt className="text-muted">{t("account.amount")}</dt>
              <dd>
                <Money amount={receivable.totalIqd} className="font-bold" />
                {receivable.revenueOn && (
                  <span className="ms-1 text-12 text-muted">
                    {t("account.revenueOn", { day: formatDay(receivable.revenueOn) })}
                  </span>
                )}
              </dd>
              {discount && (
                <>
                  <dt className="text-muted">{t("account.discount")}</dt>
                  <dd>
                    <Money amount={discount.amountIqd} className="font-bold" />
                    {discount.reason && (
                      <span className="block text-12 text-muted">{discount.reason}</span>
                    )}
                  </dd>
                </>
              )}
            </>
          )}
          <dt className="text-muted">{t("account.paid")}</dt>
          <dd>
            <Money amount={paid} className="font-bold" />
          </dd>
          <dt className="text-muted">{t("account.balance")}</dt>
          <dd
            className={cn(
              "font-extrabold",
              balance > 0 ? "text-warn-fg" : balance < 0 ? "text-teal" : "text-ok-fg",
            )}
          >
            {balance > 0 ? (
              <>
                {t("account.owes")} <Money amount={balance} />
              </>
            ) : balance < 0 ? (
              <>
                {t("account.credit")} <Money amount={-balance} />
              </>
            ) : (
              t("account.settled")
            )}
          </dd>
        </dl>
      )}

      {payments.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label={t("account.payments")}>
          {payments.map((payment) => (
            <li key={payment.id}>
              <Link
                href={adminRevenueHref({ payment: payment.id })}
                className={cn(
                  "flex min-h-11 flex-wrap items-center gap-x-2 rounded-chip border border-border px-3 py-1.5 text-14 hover:bg-bg",
                  payment.voidedAt && "text-muted line-through",
                )}
              >
                <span className="font-bold">{formatDay(payment.paidOn)}</span>
                <span className="text-muted">{boxName.get(payment.accountId)}</span>
                {payment.automatic && (
                  <span className="rounded-full bg-well px-2 text-12 font-bold text-body-2">
                    {t("payment.automatic")}
                  </span>
                )}
                {payment.voidedAt && (
                  <span className="text-12 font-bold no-underline">{t("voided")}</span>
                )}
                <Money
                  amount={payment.amountIqd}
                  className={cn("ms-auto font-bold", payment.voidedAt && "text-muted")}
                />
                <span className="sr-only">{t("payment.open")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <ItemAccountActions
        // Fresh forms after every change.
        key={`${paid}-${balance}-${discount?.id ?? ""}-${discount?.amountIqd ?? ""}`}
        target={{
          orderId: item.kind === "order" ? item.id : null,
          subscriptionId: item.kind === "subscription" ? item.id : null,
          saleId: item.kind === "sale" ? item.id : null,
        }}
        canPay={canPay}
        owed={balance}
        paid={paid}
        discount={
          discount
            ? { id: discount.id, amountIqd: discount.amountIqd, reason: discount.reason }
            : null
        }
        discountMax={item.kind !== "sale" && counted && receivable ? receivable.totalIqd : null}
        boxes={boxes.map((box) => ({
          id: box.id,
          label: boxName.get(box.id) ?? "",
          active: box.active,
        }))}
        today={baghdadToday()}
        startOn={startOn}
      />
    </Card>
  );
}
