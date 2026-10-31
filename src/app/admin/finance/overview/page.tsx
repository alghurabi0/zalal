import { HandCoins, Receipt } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { accountName, FinanceTabs, Money } from "@/components/admin/finance";
import { CategoryBars, MonthBars } from "@/components/admin/finance-charts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { addMonthsTo } from "@/lib/admin/calendar";
import { expenseCategories, financeAccounts } from "@/lib/admin/finance-queries";
import { adminBoxesHref, adminExpensesHref, adminReportsHref } from "@/lib/admin/finance-query";
import { expensesByCategory, profitAndLoss } from "@/lib/admin/report-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { baghdadToday, formatMonthYear } from "@/lib/dates";
import { routes } from "@/lib/routes";

/**
 * Accounting overview (A19, spec §8.3; Phase 7, task 3): the boxes and their
 * total, the last 6 months' revenue, expenses and profit, where this month's
 * money went by category, and the cash each crew holds. Low stock joins it
 * with the stock task (task 6).
 */
export default async function FinanceOverviewPage() {
  const t = await getTranslations("Admin.finance.overview");
  return (
    <AdminPage title={t("title")}>
      <FinanceTabs current="overview" />
      <Suspense fallback={<OverviewSkeleton />}>
        <Overview />
      </Suspense>
    </AdminPage>
  );
}

async function Overview() {
  await requireViewer(routes.adminFinanceOverview, "admin");
  const t = await getTranslations("Admin.finance");
  const thisMonth = baghdadToday().slice(0, 7);
  const [accounts, months, spent, categories] = await Promise.all([
    financeAccounts(),
    profitAndLoss(addMonthsTo(thisMonth, -5), thisMonth),
    expensesByCategory(thisMonth, thisMonth),
    expenseCategories(),
  ]);
  const nameOf = (account: (typeof accounts)[number]) =>
    accountName(account, (crew) => t("crewBox", { crew }));
  const total = accounts.reduce((sum, account) => sum + account.balanceIqd, 0);
  const boxes = accounts.filter((account) => account.kind !== "crew" && account.active);
  // The rest of the total, so the rows add up to it (code review).
  const crewTotal = accounts
    .filter((account) => account.kind === "crew")
    .reduce((sum, account) => sum + account.balanceIqd, 0);
  const offTotal = accounts
    .filter((account) => account.kind !== "crew" && !account.active)
    .reduce((sum, account) => sum + account.balanceIqd, 0);
  const crews = accounts
    .filter((account) => account.kind === "crew" && account.balanceIqd !== 0)
    .sort((a, b) => b.balanceIqd - a.balanceIqd);
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const where = spent
    .map((row) => ({ name: categoryName.get(row.categoryId) ?? "", totalIqd: row.totalIqd }))
    .sort((a, b) => b.totalIqd - a.totalIqd);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-18 font-extrabold">{t("overview.boxesTitle")}</h2>
          <p className="text-14 text-body-2">
            {t("overview.total")} <Money amount={total} className="text-20 font-black text-navy" />
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-divider">
          {boxes.map((account) => (
            <li key={account.id} className="flex items-center justify-between gap-3 py-2 text-15">
              <span>{nameOf(account)}</span>
              <Money amount={account.balanceIqd} className="font-extrabold" />
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 py-2 text-15">
            <span>{t("overview.crewBoxes")}</span>
            <Money amount={crewTotal} className="font-extrabold" />
          </li>
          {offTotal !== 0 && (
            <li className="flex items-center justify-between gap-3 py-2 text-15 text-muted">
              <span>{t("overview.offBoxes")}</span>
              <Money amount={offTotal} className="font-extrabold" />
            </li>
          )}
        </ul>
        <Link
          href={routes.adminFinance}
          className="inline-flex min-h-11 items-center self-start text-14 font-bold text-teal underline"
        >
          {t("overview.openBoxes")}
        </Link>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div>
          <h2 className="text-18 font-extrabold">{t("overview.crewTitle")}</h2>
          <p className="text-13 text-muted">{t("overview.crewHint")}</p>
        </div>
        {crews.length === 0 ? (
          <p className="rounded-chip bg-well px-3 py-2.5 text-14 text-body-2">
            {t("overview.crewEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-divider">
            {crews.map((account) => (
              <li
                key={account.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-15"
              >
                <span>{nameOf(account)}</span>
                <span className="flex items-center gap-3">
                  <Money amount={account.balanceIqd} className="font-extrabold" />
                  {account.balanceIqd > 0 && (
                    <Button
                      href={adminBoxesHref({ transfer: "new", from: account.id })}
                      size="sm"
                      variant="secondary"
                    >
                      <HandCoins aria-hidden className="size-4" />
                      {t("boxes.handover")}
                      <span className="sr-only"> {nameOf(account)}</span>
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5 lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-18 font-extrabold">{t("overview.monthsTitle")}</h2>
            <p className="text-13 text-muted">{t("overview.monthsHint")}</p>
          </div>
          <Button href={adminReportsHref({})} size="sm" variant="secondary">
            {t("overview.openReports")}
          </Button>
        </div>
        <MonthBars months={months} />
      </Card>

      <Card className="flex flex-col gap-3 p-5 lg:col-span-2">
        <div>
          <h2 className="text-18 font-extrabold">{t("overview.whereTitle")}</h2>
          <p className="text-13 text-muted">
            {t("overview.whereHint", { month: formatMonthYear(`${thisMonth}-15T12:00:00Z`) })}
          </p>
        </div>
        {where.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t("overview.whereEmpty")}
            description={t("overview.whereEmptyBody")}
            action={
              <Button href={adminExpensesHref({ expense: "new" })} size="sm">
                {t("overview.newExpense")}
              </Button>
            }
          />
        ) : (
          <CategoryBars rows={where} />
        )}
      </Card>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <SkeletonGroup className="grid gap-4 lg:grid-cols-2">
      <Skeleton className="h-48 rounded-card" />
      <Skeleton className="h-48 rounded-card" />
      <Skeleton className="h-80 rounded-card lg:col-span-2" />
      <Skeleton className="h-48 rounded-card lg:col-span-2" />
    </SkeletonGroup>
  );
}
