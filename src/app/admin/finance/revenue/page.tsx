import { HandCoins, Plus, ReceiptText, SearchX, Store } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { Drawer } from "@/components/admin/drawer";
import {
  accountName,
  ClosedBadge,
  FinanceTabs,
  Money,
  MonthPicker,
} from "@/components/admin/finance";
import { ReadOnlyRecord } from "@/components/admin/finance-forms";
import { ItemAccountCard } from "@/components/admin/item-account";
import { PaymentForm } from "@/components/admin/revenue-forms";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { addMonthsTo } from "@/lib/admin/calendar";
import { type FinanceAccount, financeAccounts, financeBooks } from "@/lib/admin/finance-queries";
import {
  ADMIN_REVENUE_PAGE,
  type AdminRevenueQuery,
  adminRevenueHref,
  parseAdminRevenueQuery,
} from "@/lib/admin/finance-query";
import { listCrews } from "@/lib/admin/queries";
import {
  type CustomerBalance,
  customerBalances,
  customerContact,
  customerReceivables,
  getManualSale,
  getPayment,
  listManualSales,
  listPayments,
  type ManualSale,
  type Payment,
  revenueSummary,
} from "@/lib/admin/revenue-queries";
import { firstOpenDay, isClosed } from "@/lib/admin/finance-reports";
import { requireViewer } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { baghdadToday, formatDay } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";

import { SaleForm } from "./sale-form";

/**
 * Revenue and debts (A18, spec §8.3; Phase 7, task 2): the month's revenue,
 * discounts and money in, what customers owe and hold as credit, the
 * month's payments and manual sales. `?customer=` opens a customer's
 * account (each item with its payments, refunds and discount),
 * `?payment=<id>` a payment to edit or void, `?sale=new|<id>` a manual sale.
 */
export default async function RevenuePage(props: PageProps<"/admin/finance/revenue">) {
  const t = await getTranslations("Admin.finance.revenue");
  return (
    <AdminPage title={t("title")}>
      <FinanceTabs current="revenue" />
      <Suspense fallback={<RevenueSkeleton />}>
        <Revenue {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Revenue({ searchParams }: PageProps<"/admin/finance/revenue">) {
  await requireViewer(routes.adminRevenue, "admin");
  const t = await getTranslations("Admin.finance");
  const query = parseAdminRevenueQuery(await searchParams);
  const today = baghdadToday();
  const thisMonth = today.slice(0, 7);
  const month = query.month && query.month <= thisMonth ? query.month : thisMonth;
  const [accounts, summary, owed, credit, payments, sales, books] = await Promise.all([
    financeAccounts(),
    revenueSummary(month),
    customerBalances("owed", query.n),
    customerBalances("credit", query.n),
    listPayments(month, query.n),
    listManualSales(month, query.n),
    financeBooks(),
  ]);
  const hrefFor = (patch: Partial<AdminRevenueQuery>) => adminRevenueHref({ ...query, ...patch });
  const closed = { customer: undefined, payment: undefined, sale: undefined };
  const accountNames = new Map(
    accounts.map((account) => [account.id, accountName(account, (crew) => t("crewBox", { crew }))]),
  );
  const more = owed.more || credit.more || payments.more || sales.more;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker
            month={month}
            prevHref={hrefFor({ ...closed, month: addMonthsTo(month, -1), n: undefined })}
            nextHref={
              month < thisMonth
                ? hrefFor({ ...closed, month: addMonthsTo(month, 1), n: undefined })
                : null
            }
          />
          {isClosed(books, month) && <ClosedBadge />}
        </div>
        <Button href={hrefFor({ ...closed, sale: "new" })} size="sm" scroll={false}>
          <Plus aria-hidden className="size-4" />
          {t("revenue.newSale")}
        </Button>
      </div>

      <section
        aria-label={t("revenue.summaryTitle")}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <Stat
          label={t("revenue.revenue")}
          amount={summary.revenueIqd}
          hint={t("revenue.revenueHint")}
        />
        <Stat label={t("revenue.discounts")} amount={summary.discountsIqd} />
        <Stat
          label={t("revenue.received")}
          amount={summary.receivedIqd}
          hint={t("revenue.receivedHint")}
        />
        <Stat
          label={t("revenue.owed")}
          amount={summary.owedIqd}
          hint={t("revenue.nowHint")}
          tone="warn"
        />
        <Stat label={t("revenue.credit")} amount={summary.creditIqd} hint={t("revenue.nowHint")} />
      </section>

      <BalanceTable
        title={t("revenue.owedTitle")}
        empty={t("revenue.owedEmpty")}
        rows={owed.rows}
        hrefFor={hrefFor}
      />
      <BalanceTable
        title={t("revenue.creditTitle")}
        empty={t("revenue.creditEmpty")}
        rows={credit.rows}
        hrefFor={hrefFor}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-18 font-extrabold">{t("revenue.paymentsTitle")}</h2>
        {payments.payments.length === 0 ? (
          <Card className="py-6">
            <EmptyState
              icon={HandCoins}
              title={t("revenue.paymentsEmpty")}
              description={t("revenue.paymentsEmptyBody")}
            />
          </Card>
        ) : (
          <PaymentTable
            payments={payments.payments}
            accountNames={accountNames}
            hrefFor={hrefFor}
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-18 font-extrabold">{t("revenue.salesTitle")}</h2>
        </div>
        {sales.sales.length === 0 ? (
          <Card className="py-6">
            <EmptyState
              icon={Store}
              title={t("revenue.salesEmpty")}
              description={t("revenue.salesEmptyBody")}
              action={
                <Button href={hrefFor({ ...closed, sale: "new" })} size="sm" scroll={false}>
                  {t("revenue.firstSale")}
                </Button>
              }
            />
          </Card>
        ) : (
          <SaleTable sales={sales.sales} hrefFor={hrefFor} />
        )}
      </section>

      {more && (
        <Button
          href={hrefFor({ ...closed, n: query.n + ADMIN_REVENUE_PAGE })}
          variant="secondary"
          size="sm"
          scroll={false}
          className="self-center"
        >
          {t("revenue.more")}
        </Button>
      )}

      {query.customer && (
        <Suspense key={query.customer}>
          <CustomerDrawer customerId={query.customer} closeHref={hrefFor(closed)} />
        </Suspense>
      )}
      {query.payment && (
        <Suspense key={query.payment}>
          <PaymentDrawer
            id={query.payment}
            accounts={accounts}
            accountNames={accountNames}
            today={today}
            closeHref={hrefFor(closed)}
          />
        </Suspense>
      )}
      {query.sale && (
        <Suspense key={query.sale}>
          <SaleDrawer
            id={query.sale}
            accounts={accounts}
            accountNames={accountNames}
            today={today}
            closeHref={hrefFor(closed)}
            listQuery={{ month: query.month, n: query.n }}
          />
        </Suspense>
      )}
    </>
  );
}

function Stat({
  label,
  amount,
  hint,
  tone,
}: {
  label: string;
  amount: number;
  hint?: string;
  tone?: "warn";
}) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-13 font-bold text-muted">{label}</span>
      <Money
        amount={amount}
        className={cn(
          "text-20 font-black",
          tone === "warn" && amount > 0 ? "text-warn-fg" : "text-navy",
        )}
      />
      {hint && <span className="text-12 text-muted">{hint}</span>}
    </Card>
  );
}

async function BalanceTable({
  title,
  empty,
  rows,
  hrefFor,
}: {
  title: string;
  empty: string;
  rows: CustomerBalance[];
  hrefFor: (patch: Partial<AdminRevenueQuery>) => string;
}) {
  const t = await getTranslations("Admin.finance");
  const columns = ["customer", "items", "amount", "paid", "balance"] as const;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-18 font-extrabold">{title}</h2>
      {rows.length === 0 ? (
        <p className="rounded-card border border-border bg-surface px-4 py-3 text-14 text-muted">
          {empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-2xl text-14">
            <caption className="sr-only">{title}</caption>
            <thead className="bg-well text-13 text-muted">
              <tr>
                {columns.map((column) => (
                  <th key={column} scope="col" className="px-3 py-2.5 text-start font-bold">
                    {t(`revenue.columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.customerId ?? row.saleId}
                  className="border-t border-divider align-top"
                >
                  <td className="p-0">
                    <Link
                      href={
                        row.customerId
                          ? hrefFor({
                              customer: row.customerId,
                              payment: undefined,
                              sale: undefined,
                            })
                          : hrefFor({
                              sale: row.saleId ?? undefined,
                              customer: undefined,
                              payment: undefined,
                            })
                      }
                      scroll={false}
                      className="flex min-h-11 flex-col justify-center px-3 py-1.5 underline-offset-2 hover:underline"
                    >
                      <span className="font-extrabold text-teal">
                        {row.customerName ?? t("revenue.deletedCustomer")}
                      </span>
                      {row.customerPhone && (
                        <span dir="ltr" className="text-end text-12 text-muted">
                          {formatPhone(row.customerPhone)}
                        </span>
                      )}
                      <span className="sr-only">{t("revenue.openAccount")}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    {row.kind === "sale"
                      ? t("revenue.saleItem")
                      : t("revenue.itemCount", { count: row.items })}
                  </td>
                  <td className="px-3 py-3">
                    <Money amount={row.amountIqd} />
                  </td>
                  <td className="px-3 py-3">
                    <Money amount={row.paidIqd} />
                  </td>
                  <td className="px-3 py-3">
                    <Money amount={Math.abs(row.balanceIqd)} className="font-extrabold" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function PaymentTable({
  payments,
  accountNames,
  hrefFor,
}: {
  payments: Payment[];
  accountNames: Map<string, string>;
  hrefFor: (patch: Partial<AdminRevenueQuery>) => string;
}) {
  const t = await getTranslations("Admin.finance");
  const columns = ["date", "for", "account", "amount"] as const;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-2xl text-14">
        <caption className="sr-only">{t("revenue.paymentsTitle")}</caption>
        <thead className="bg-well text-13 text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2.5 text-start font-bold">
                {t(`revenue.paymentColumns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr
              key={payment.id}
              className={cn(
                "border-t border-divider align-top",
                payment.voidedAt && "text-muted line-through",
              )}
            >
              <td className="p-0">
                <Link
                  href={hrefFor({ payment: payment.id, customer: undefined, sale: undefined })}
                  scroll={false}
                  className="flex min-h-11 items-center px-3 font-extrabold whitespace-nowrap text-teal underline-offset-2 hover:underline"
                >
                  {formatDay(payment.paidOn)}
                  <span className="sr-only"> {t("payment.open")}</span>
                </Link>
              </td>
              <td className="px-3 py-3">
                <PaymentFor payment={payment} />
                {payment.voidedAt && (
                  <span className="ms-2 text-12 font-bold no-underline">{t("voided")}</span>
                )}
              </td>
              <td className="px-3 py-3">{accountNames.get(payment.accountId)}</td>
              <td className="px-3 py-3">
                <Money
                  amount={payment.amountIqd}
                  className={cn("font-bold", payment.voidedAt && "text-muted")}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What a payment is for: "طلب #1024 · اسم", "اشتراك · اسم" or "بيع · اسم". */
async function PaymentFor({ payment }: { payment: Payment }) {
  const t = await getTranslations("Admin.finance");
  const name = payment.customerName ?? t("revenue.deletedCustomer");
  if (payment.orderId) {
    return (
      <>
        {t.rich("revenue.forOrder", {
          number: payment.orderNumber ?? 0,
          num: (chunks) => <span dir="ltr">{chunks}</span>,
        })}{" "}
        · {name}
        {payment.automatic && (
          <span className="ms-2 rounded-full bg-well px-2 text-12 font-bold text-body-2">
            {t("payment.automatic")}
          </span>
        )}
      </>
    );
  }
  return (
    <>
      {payment.subscriptionId
        ? t("revenue.forSubscription", { name })
        : t("revenue.forSale", { name })}
    </>
  );
}

async function SaleTable({
  sales,
  hrefFor,
}: {
  sales: ManualSale[];
  hrefFor: (patch: Partial<AdminRevenueQuery>) => string;
}) {
  const t = await getTranslations("Admin.finance");
  const columns = ["date", "customer", "service", "amount"] as const;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-2xl text-14">
        <caption className="sr-only">{t("revenue.salesTitle")}</caption>
        <thead className="bg-well text-13 text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2.5 text-start font-bold">
                {t(`revenue.saleColumns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sales.map((sale) => (
            <tr
              key={sale.id}
              className={cn(
                "border-t border-divider align-top",
                sale.voidedAt && "text-muted line-through",
              )}
            >
              <td className="p-0">
                <Link
                  href={hrefFor({ sale: sale.id, customer: undefined, payment: undefined })}
                  scroll={false}
                  className="flex min-h-11 items-center px-3 font-extrabold whitespace-nowrap text-teal underline-offset-2 hover:underline"
                >
                  {formatDay(sale.soldOn)}
                  <span className="sr-only"> {t("revenue.openSale")}</span>
                </Link>
              </td>
              <td className="px-3 py-3">
                {sale.customerName}
                {sale.voidedAt && (
                  <span className="ms-2 text-12 font-bold no-underline">{t("voided")}</span>
                )}
              </td>
              <td className="px-3 py-3">
                {sale.service}
                {sale.place && <span className="block text-12 text-muted">{sale.place}</span>}
              </td>
              <td className="px-3 py-3">
                <Money
                  amount={sale.amountIqd}
                  className={cn("font-bold", sale.voidedAt && "text-muted")}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A customer's account: each of their items with a balance, with its payments and discount. */
async function CustomerDrawer({
  customerId,
  closeHref,
}: {
  customerId: string;
  closeHref: string;
}) {
  const t = await getTranslations("Admin.finance");
  const [items, contact, boxes, settings] = await Promise.all([
    customerReceivables(customerId),
    customerContact(customerId),
    financeAccounts(),
    financeBooks(),
  ]);
  const books = { boxes, books: settings };
  const name = contact?.name ?? t("revenue.deletedCustomer");
  return (
    <Drawer closeHref={closeHref} title={t("revenue.customerTitle", { name })}>
      {contact?.phone && (
        <p dir="ltr" className="text-end text-14 text-muted">
          {formatPhone(contact.phone)}
        </p>
      )}
      <Link
        href={routes.adminCustomer(customerId)}
        className="inline-flex min-h-11 items-center self-start text-14 font-bold text-teal underline"
      >
        {t("revenue.openCustomer")}
      </Link>
      {items.length === 0 ? (
        <EmptyState icon={ReceiptText} title={t("revenue.customerSettled")} />
      ) : (
        items.map((item) =>
          item.kind === "order" && item.orderId ? (
            <section key={item.orderId} className="flex flex-col gap-2">
              <Link
                href={routes.adminOrder(item.orderId)}
                className="inline-flex min-h-11 items-center self-start text-15 font-extrabold text-teal underline"
              >
                {t.rich("revenue.forOrder", {
                  number: item.orderNumber ?? 0,
                  num: (chunks) => <span dir="ltr">{chunks}</span>,
                })}
              </Link>
              <ItemAccountCard item={{ kind: "order", id: item.orderId }} books={books} />
            </section>
          ) : item.subscriptionId ? (
            <section key={item.subscriptionId} className="flex flex-col gap-2">
              <Link
                href={routes.adminSubscription(item.subscriptionId)}
                className="inline-flex min-h-11 items-center self-start text-15 font-extrabold text-teal underline"
              >
                {t("revenue.subscriptionLink")}
              </Link>
              <ItemAccountCard
                item={{ kind: "subscription", id: item.subscriptionId }}
                books={books}
              />
            </section>
          ) : null,
        )
      )}
    </Drawer>
  );
}

async function PaymentDrawer({
  id,
  accounts,
  accountNames,
  today,
  closeHref,
}: {
  id: string;
  accounts: FinanceAccount[];
  accountNames: Map<string, string>;
  today: string;
  closeHref: string;
}) {
  const t = await getTranslations("Admin.finance");
  const [payment, books] = await Promise.all([getPayment(id), financeBooks()]);
  if (!payment) {
    return (
      <Drawer title={t("payment.notFound")} closeHref={closeHref}>
        <EmptyState icon={SearchX} title={t("payment.notFound")} description={t("notFoundBody")} />
      </Drawer>
    );
  }
  const negative = payment.amountIqd < 0;
  return (
    <Drawer
      closeHref={closeHref}
      title={negative ? t("payment.editRefundTitle") : t("payment.editTitle")}
    >
      <p className="text-15">
        <PaymentFor payment={payment} />
      </p>
      {payment.orderId && (
        <Link
          href={routes.adminOrder(payment.orderId)}
          className="inline-flex min-h-11 items-center self-start text-14 font-bold text-teal underline"
        >
          {t("revenue.openOrder")}
        </Link>
      )}
      {payment.voidedAt || isClosed(books, payment.paidOn) ? (
        <ReadOnlyPayment payment={payment} accountNames={accountNames} />
      ) : (
        <PaymentForm
          key={payment.id}
          target={{
            orderId: payment.orderId,
            subscriptionId: payment.subscriptionId,
            saleId: payment.saleId,
          }}
          payment={payment}
          refund={negative}
          defaultAmount={null}
          boxes={accounts.map((account) => ({
            id: account.id,
            label: accountNames.get(account.id) ?? "",
            active: account.active,
          }))}
          today={today}
          firstDay={firstOpenDay(books)}
          done={{ closeHref }}
        />
      )}
    </Drawer>
  );
}

async function ReadOnlyPayment({
  payment,
  accountNames,
}: {
  payment: Payment;
  accountNames: Map<string, string>;
}) {
  const t = await getTranslations("Admin.finance");
  return (
    <ReadOnlyRecord
      rows={[
        [t("payment.date"), formatDay(payment.paidOn)],
        [t("payment.account"), accountNames.get(payment.accountId)],
        [t("amount"), <Money key="amount" amount={payment.amountIqd} />],
        [t("payment.note"), payment.note ?? t("none")],
      ]}
      voidedAt={payment.voidedAt}
      voidedBy={payment.voidedBy}
      reason={payment.voidReason}
    />
  );
}

async function SaleDrawer({
  id,
  accounts,
  accountNames,
  today,
  closeHref,
  listQuery,
}: {
  id: string;
  accounts: FinanceAccount[];
  accountNames: Map<string, string>;
  today: string;
  closeHref: string;
  listQuery: { month: string | undefined; n: number };
}) {
  const t = await getTranslations("Admin.finance");
  const isNew = id === "new";
  const [sale, books, crews] = await Promise.all([
    isNew ? null : getManualSale(id),
    financeBooks(),
    listCrews(),
  ]);
  if (!isNew && !sale) {
    return (
      <Drawer title={t("sale.notFound")} closeHref={closeHref}>
        <EmptyState icon={SearchX} title={t("sale.notFound")} description={t("notFoundBody")} />
      </Drawer>
    );
  }
  return (
    <Drawer closeHref={closeHref} title={sale ? t("sale.editTitle") : t("sale.newTitle")}>
      {sale && !sale.voidedAt && <ItemAccountCard item={{ kind: "sale", id: sale.id }} />}
      <SaleForm
        key={sale?.id ?? "new"}
        sale={sale}
        boxes={accounts.map((account) => ({
          id: account.id,
          label: accountNames.get(account.id) ?? "",
          active: account.active,
        }))}
        crews={crews}
        today={today}
        firstDay={firstOpenDay(books)}
        closed={sale !== null && isClosed(books, sale.soldOn)}
        closeHref={closeHref}
        listQuery={listQuery}
      />
    </Drawer>
  );
}

function RevenueSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4">
      <Skeleton className="h-11 w-72" />
      <Skeleton className="h-24 rounded-card" />
      <Skeleton className="h-64 rounded-card" />
      <Skeleton className="h-64 rounded-card" />
    </SkeletonGroup>
  );
}
