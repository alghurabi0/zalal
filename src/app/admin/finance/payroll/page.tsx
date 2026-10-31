import { HandCoins, Plus, SearchX, Users } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { Drawer } from "@/components/admin/drawer";
import { ClosedBadge, FinanceTabs, Money, MonthPicker } from "@/components/admin/finance";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { addMonthsTo, monthRange } from "@/lib/admin/calendar";
import { financeBooks } from "@/lib/admin/finance-queries";
import {
  type AdminPayrollQuery,
  adminExpensesHref,
  adminPayrollHref,
  parseAdminPayrollQuery,
} from "@/lib/admin/finance-query";
import { type FinanceBooks, firstOpenDay, isClosed } from "@/lib/admin/finance-reports";
import {
  crewOptions,
  getWorkerDetail,
  payrollMonth,
  type PayrollRow,
  unlinkedWages,
} from "@/lib/admin/payroll-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { baghdadToday } from "@/lib/dates";
import { routes } from "@/lib/routes";

import {
  AdjustmentSection,
  CrewSection,
  DaysSection,
  RateSection,
  WorkerForm,
  WorkerSummary,
} from "./worker-forms";

/**
 * Payroll (A21, spec §8.3; Phase 7, task 4): each worker's month, earned
 * against paid, and their balance (owed, or an advance) at its end.
 * `?worker=new|<id>` opens the worker's drawer.
 */
export default async function PayrollPage(props: PageProps<"/admin/finance/payroll">) {
  const t = await getTranslations("Admin.finance.payroll");
  return (
    <AdminPage title={t("title")}>
      <FinanceTabs current="payroll" />
      <Suspense fallback={<PayrollSkeleton />}>
        <Payroll {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Payroll({ searchParams }: PageProps<"/admin/finance/payroll">) {
  await requireViewer(routes.adminPayroll, "admin");
  const t = await getTranslations("Admin.finance");
  const query = parseAdminPayrollQuery(await searchParams);
  const today = baghdadToday();
  const thisMonth = today.slice(0, 7);
  const month = query.month && query.month <= thisMonth ? query.month : thisMonth;
  const [rows, unlinked, books] = await Promise.all([
    payrollMonth(month),
    unlinkedWages(month),
    financeBooks(),
  ]);
  const hrefFor = (patch: Partial<AdminPayrollQuery>) =>
    adminPayrollHref({ ...query, month: query.month, ...patch });
  // Switched-off workers show apart, and only with something in the month or a balance.
  const shown = rows.filter((row) => row.active);
  const inactive = rows.filter(
    (row) => !row.active && (row.earnedIqd !== 0 || row.paidIqd !== 0 || row.balanceIqd !== 0),
  );
  const sum = (pick: (row: PayrollRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker
            month={month}
            prevHref={hrefFor({ month: addMonthsTo(month, -1), worker: undefined })}
            nextHref={
              month < thisMonth
                ? hrefFor({ month: addMonthsTo(month, 1), worker: undefined })
                : null
            }
          />
          {isClosed(books, month) && <ClosedBadge />}
        </div>
        <Button href={hrefFor({ worker: "new" })} size="sm" scroll={false}>
          <Plus aria-hidden className="size-4" />
          {t("payroll.new")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card className="py-6">
          <EmptyState
            icon={Users}
            title={t("payroll.emptyTitle")}
            description={t("payroll.emptyBody")}
            action={
              <Button href={hrefFor({ worker: "new" })} size="sm" scroll={false}>
                {t("payroll.first")}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <section
            aria-label={t("payroll.totalsTitle")}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Stat
              label={t("payroll.earned")}
              amount={sum((row) => row.earnedIqd)}
              hint={t("payroll.earnedHint")}
            />
            <Stat
              label={t("payroll.paid")}
              amount={sum((row) => row.paidIqd)}
              hint={t("payroll.paidHint")}
            />
            <Stat
              label={t("payroll.owedTotal")}
              amount={sum((row) => Math.max(row.balanceIqd, 0))}
              hint={t("payroll.nowHint")}
              tone="warn"
            />
            <Stat
              label={t("payroll.advancesTotal")}
              amount={sum((row) => Math.max(-row.balanceIqd, 0))}
              hint={t("payroll.nowHint")}
            />
          </section>
          {unlinked > 0 && (
            <p className="text-14 text-body-2">
              {t("payroll.unlinked")} <Money amount={unlinked} className="font-bold" />
            </p>
          )}
          <PayrollTable rows={shown} caption={t("payroll.caption")} hrefFor={hrefFor} />
          {inactive.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-18 font-extrabold">{t("payroll.inactiveTitle")}</h2>
              <PayrollTable
                rows={inactive}
                caption={t("payroll.inactiveTitle")}
                hrefFor={hrefFor}
              />
            </section>
          )}
        </>
      )}

      {query.worker && (
        <Suspense key={query.worker}>
          <WorkerDrawer
            id={query.worker}
            month={month}
            today={today}
            books={books}
            hrefFor={hrefFor}
          />
        </Suspense>
      )}
    </>
  );
}

async function Stat({
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

/** Owed (above 0), an advance (below 0, shown as a positive sum), or settled. */
async function Balance({ amount }: { amount: number }) {
  const t = await getTranslations("Admin.finance.payroll");
  if (amount === 0) return <span className="text-muted">{t("settled")}</span>;
  return (
    <span className="flex flex-col">
      <span className={cn("text-12 font-bold", amount > 0 ? "text-warn-fg" : "text-body-2")}>
        {amount > 0 ? t("owed") : t("advance")}
      </span>
      <Money amount={Math.abs(amount)} className="font-bold" />
    </span>
  );
}

async function PayrollTable({
  rows,
  caption,
  hrefFor,
}: {
  rows: PayrollRow[];
  caption: string;
  hrefFor: (patch: Partial<AdminPayrollQuery>) => string;
}) {
  const t = await getTranslations("Admin.finance.payroll");
  const columns = ["worker", "crew", "pay", "work", "earned", "paid", "balance"] as const;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-4xl text-14">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-well text-13 text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2.5 text-start font-bold">
                {t(`columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.workerId} className="border-t border-divider align-top">
              <th scope="row" className="p-0 text-start">
                <Link
                  href={hrefFor({ worker: row.workerId })}
                  scroll={false}
                  className="flex min-h-11 items-center px-3 font-extrabold text-teal underline-offset-2 hover:underline"
                >
                  {row.name}
                  <span className="sr-only"> {t("open")}</span>
                </Link>
              </th>
              <td className="px-3 py-3">{row.crewName ?? t("noCrew")}</td>
              <td className="px-3 py-3">
                {row.payType ? (
                  <span className="flex flex-col">
                    <span>{t(`payTypes.${row.payType}`)}</span>
                    {row.payType !== "none" && row.rateIqd !== null && (
                      <Money amount={row.rateIqd} className="text-13 text-body-2" />
                    )}
                  </span>
                ) : (
                  <span className="text-muted">{t("noRate")}</span>
                )}
              </td>
              <td className="px-3 py-3">{t("work", { visits: row.visits, days: row.days })}</td>
              <td className="px-3 py-3">
                <Money amount={row.earnedIqd} className="font-bold" />
              </td>
              <td className="px-3 py-3">
                <Money amount={row.paidIqd} />
              </td>
              <td className="px-3 py-3">
                <Balance amount={row.balanceIqd} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function WorkerDrawer({
  id,
  month,
  today,
  books,
  hrefFor,
}: {
  id: string;
  month: string;
  today: string;
  books: FinanceBooks;
  hrefFor: (patch: Partial<AdminPayrollQuery>) => string;
}) {
  const t = await getTranslations("Admin.finance");
  const closeHref = hrefFor({ worker: undefined });
  const booksClosed = books.closedThrough !== null;
  const workerHref = (workerId: string) => hrefFor({ worker: workerId });
  const monthParam = month === today.slice(0, 7) ? undefined : month;

  if (id === "new") {
    return (
      <Drawer title={t("worker.newTitle")} closeHref={closeHref}>
        <WorkerForm
          worker={null}
          booksClosed={booksClosed}
          month={monthParam}
          closeHref={closeHref}
        />
      </Drawer>
    );
  }

  const [detail, rows, crews] = await Promise.all([
    getWorkerDetail(id, month),
    payrollMonth(month, id),
    crewOptions(),
  ]);
  const row = rows[0];
  if (!detail || !row) {
    return (
      <Drawer title={t("worker.notFound")} closeHref={closeHref}>
        <EmptyState icon={SearchX} title={t("worker.notFound")} description={t("notFoundBody")} />
      </Drawer>
    );
  }

  const { to: monthEnd } = monthRange(month);
  const open = firstOpenDay(books);
  // The days a new record may take in this month: open, in the books, not after today.
  const firstDay = open > `${month}-01` ? open : `${month}-01`;
  const lastDay = monthEnd < today ? monthEnd : today;
  const closed = isClosed(books, month);
  const dailyPay =
    row.payType === "per_day" ||
    detail.days.length > 0 ||
    detail.rates.some((rate) => rate.payType === "per_day" && !rate.voidedAt);

  return (
    <Drawer title={detail.worker.name} closeHref={closeHref}>
      <div className="flex flex-col gap-6">
        {closed && (
          <p className="rounded-chip bg-warn-bg px-3 py-2 text-14 font-bold text-warn-fg">
            {t("worker.closedMonth")}
          </p>
        )}
        <WorkerSummary
          rows={[
            [t("worker.base"), row.baseIqd],
            [t("worker.bonuses"), row.bonusesIqd],
            [t("worker.deductions"), -row.deductionsIqd],
            [t("worker.earned"), row.earnedIqd],
            [t("worker.paid"), row.paidIqd],
            [t("worker.balance"), row.balanceIqd],
          ]}
          pay={
            detail.worker.active && (
              <Button
                href={adminExpensesHref({ expense: "new", worker: detail.worker.id })}
                size="sm"
                className="self-start"
              >
                <HandCoins aria-hidden className="size-4" />
                {t("worker.pay")}
              </Button>
            )
          }
        />
        <section className="flex flex-col gap-3">
          <h3 className="text-16 font-extrabold">{t("worker.detailsTitle")}</h3>
          <WorkerForm
            key={`${detail.worker.id}-${detail.worker.name}-${detail.worker.active}`}
            worker={detail.worker}
            booksClosed={booksClosed}
            month={monthParam}
            closeHref={closeHref}
          />
        </section>
        <CrewSection
          workerId={detail.worker.id}
          memberships={detail.memberships}
          crews={crews}
          today={today}
        />
        <RateSection
          workerId={detail.worker.id}
          rates={detail.rates}
          today={today}
          closeHref={workerHref(detail.worker.id)}
        />
        <AdjustmentSection
          workerId={detail.worker.id}
          adjustments={detail.adjustments}
          firstDay={firstDay}
          lastDay={lastDay}
          closed={closed}
          closeHref={workerHref(detail.worker.id)}
        />
        {dailyPay && (
          <DaysSection
            key={detail.days.join()}
            workerId={detail.worker.id}
            month={month}
            days={detail.days}
            crewDays={detail.crewDays}
            firstDay={firstDay}
            lastDay={lastDay}
            closed={closed}
          />
        )}
      </div>
    </Drawer>
  );
}

function PayrollSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4">
      <Skeleton className="h-11 w-72" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
      </div>
      <Skeleton className="h-96 rounded-card" />
    </SkeletonGroup>
  );
}
