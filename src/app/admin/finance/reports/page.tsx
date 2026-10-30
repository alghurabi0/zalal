import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { ClosedBadge, FinanceTabs, Money, MonthPicker } from "@/components/admin/finance";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { addMonthsTo } from "@/lib/admin/calendar";
import { expenseCategories, financeBooks } from "@/lib/admin/finance-queries";
import { adminReportsHref, parseAdminReportsQuery } from "@/lib/admin/finance-query";
import {
  type FinanceBooks,
  isClosed,
  type ReportLine,
  reportLines,
} from "@/lib/admin/finance-reports";
import { expensesByCategory, profitAndLoss } from "@/lib/admin/report-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { baghdadToday, formatDay, formatMonthName, formatMonthYear } from "@/lib/dates";
import { routes } from "@/lib/routes";

import { CloseMonth, PrintButton, ReopenMonth } from "./month-close";

/**
 * Reports (A20, spec §8.3; Phase 7, task 3). `?month=` (this month by
 * default): the month's profit and loss on the accrual basis, its money in
 * and out, and its close; `?year=`: the twelve months side by side. Both
 * download as CSV and print without the dashboard around them.
 */
export default async function FinanceReportsPage(props: PageProps<"/admin/finance/reports">) {
  const t = await getTranslations("Admin.finance.reports");
  return (
    <AdminPage title={t("title")}>
      <FinanceTabs current="reports" />
      <Suspense fallback={<ReportsSkeleton />}>
        <Reports {...props} />
      </Suspense>
    </AdminPage>
  );
}

const monthLabel = (month: string) => formatMonthYear(`${month}-15T12:00:00Z`);

async function Reports({ searchParams }: PageProps<"/admin/finance/reports">) {
  await requireViewer(routes.adminFinanceReports, "admin");
  const t = await getTranslations("Admin.finance.reports");
  const query = parseAdminReportsQuery(await searchParams);
  const today = baghdadToday();
  const thisMonth = today.slice(0, 7);
  const thisYear = today.slice(0, 4);
  const year = query.year && query.year <= thisYear ? query.year : null;
  const month = !year && query.month && query.month <= thisMonth ? query.month : thisMonth;
  const [from, to] = year ? [`${year}-01`, `${year}-12`] : [month, month];
  const [books, months, byCategory, categories] = await Promise.all([
    financeBooks(),
    profitAndLoss(from, to),
    expensesByCategory(from, to),
    expenseCategories(),
  ]);
  const lines = reportLines(
    months,
    byCategory,
    new Map(categories.map((category) => [category.id, category.name])),
  );
  const title = year ? t("yearTitle", { year }) : t("monthTitle", { month: monthLabel(month) });
  const csvHref = adminReportsHref(year ? { year } : { month }, true);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <nav aria-label={t("viewLabel")} className="flex gap-2">
          <ViewLink href={adminReportsHref({ month })} on={!year} label={t("monthView")} />
          <ViewLink
            href={adminReportsHref({ year: year ?? thisYear })}
            on={!!year}
            label={t("yearView")}
          />
        </nav>
        {year ? (
          <YearPicker year={year} thisYear={thisYear} />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <MonthPicker
              month={month}
              prevHref={adminReportsHref({ month: addMonthsTo(month, -1) })}
              nextHref={
                month < thisMonth ? adminReportsHref({ month: addMonthsTo(month, 1) }) : null
              }
            />
            {isClosed(books, month) && <ClosedBadge />}
          </div>
        )}
      </div>

      <Card className="flex flex-col gap-4 p-5 print:border-0 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-20 font-black">{title}</h2>
            <p className="max-w-2xl text-13 text-muted">{t("accrualHint")}</p>
            <p className="hidden text-12 text-muted print:block">
              {t("printedOn", { day: formatDay(today) })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            {/* A file, not a page: a plain link, so the browser downloads it. */}
            <a
              href={csvHref}
              download
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              <Download aria-hidden className="size-4" />
              {t("csv")}
            </a>
            <PrintButton />
          </div>
        </div>
        <ReportTable
          lines={lines}
          columns={year ? months.map((m) => formatMonthName(`${m.month}-15`)) : null}
          caption={title}
        />
      </Card>

      {!year && <MonthState month={month} thisMonth={thisMonth} books={books} />}
    </>
  );
}

function ViewLink({ href, on, label }: { href: string; on: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center rounded-full border-2 px-4 text-14 font-bold",
        on ? "border-teal bg-selected text-teal" : "border-border bg-surface text-muted",
      )}
    >
      {label}
    </Link>
  );
}

async function YearPicker({ year, thisYear }: { year: string; thisYear: string }) {
  const t = await getTranslations("Admin.finance.reports");
  const prev = String(Number(year) - 1);
  const next = String(Number(year) + 1);
  return (
    <div className="flex items-center gap-1">
      <Button
        href={adminReportsHref({ year: prev })}
        variant="secondary"
        size="sm"
        aria-label={t("prevYear")}
      >
        <ChevronRight aria-hidden className="size-4" />
      </Button>
      <span
        dir="ltr"
        className="flex min-h-11 items-center rounded-full border-2 border-navy bg-navy px-4 text-14 font-bold text-white"
      >
        {year}
      </span>
      {year < thisYear ? (
        <Button
          href={adminReportsHref({ year: next })}
          variant="secondary"
          size="sm"
          aria-label={t("nextYear")}
        >
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
      ) : (
        <Button variant="secondary" size="sm" aria-label={t("nextYear")} disabled>
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
      )}
    </div>
  );
}

/**
 * The report's lines under their sections: one amount column for a month,
 * or a column per month and the total for a year.
 */
async function ReportTable({
  lines,
  columns,
  caption,
}: {
  lines: ReportLine[];
  columns: string[] | null;
  caption: string;
}) {
  const t = await getTranslations("Admin.finance.reports");
  const sections = ["revenue", "expenses", "profit", "cash"] as const;
  const width = columns ? columns.length + 2 : 2;
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-14", columns && "min-w-5xl text-13")}>
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-well text-muted print:bg-surface">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-bold">
              {t("columns.line")}
            </th>
            {columns ? (
              columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-2 py-2 text-start font-bold whitespace-nowrap"
                >
                  {column}
                </th>
              ))
            ) : (
              <th scope="col" className="px-3 py-2 text-start font-bold">
                {t("columns.amount")}
              </th>
            )}
            {columns && (
              <th scope="col" className="px-2 py-2 text-start font-bold">
                {t("columns.total")}
              </th>
            )}
          </tr>
        </thead>
        {sections.map((section) => {
          const rows = lines.filter((line) => line.section === section);
          return (
            <tbody key={section}>
              {section !== "profit" && (
                <tr className="border-t border-border">
                  <th
                    scope="colgroup"
                    colSpan={width}
                    className="px-3 pt-4 pb-1 text-start text-15 font-extrabold text-navy"
                  >
                    {t(`sections.${section}`)}
                  </th>
                </tr>
              )}
              {section === "expenses" && rows.length === 1 && (
                <tr>
                  <td colSpan={width} className="px-3 py-1.5 text-muted">
                    {t("noExpenses")}
                  </td>
                </tr>
              )}
              {rows.map((line) => {
                const label =
                  "figure" in line.label ? t(`figures.${line.label.figure}`) : line.label.category;
                const strong = line.weight !== "item";
                return (
                  <tr
                    key={label}
                    className={cn(
                      "border-t border-divider",
                      line.weight === "total" &&
                        "border-t-2 border-navy bg-selected print:bg-surface",
                    )}
                  >
                    <th
                      scope="row"
                      className={cn(
                        "px-3 py-2 text-start",
                        strong ? "font-extrabold" : "ps-6 font-normal",
                      )}
                    >
                      {label}
                    </th>
                    {(columns ? [...line.values, line.total] : [line.total]).map((value, i) => (
                      <td key={i} className={cn("px-2 py-2", !columns && "px-3")}>
                        <Money amount={value} className={cn(strong && "font-extrabold")} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

/** Whether the month is closed, and the one way it can change: close the next month, or reopen the last. */
async function MonthState({
  month,
  thisMonth,
  books,
}: {
  month: string;
  thisMonth: string;
  books: FinanceBooks;
}) {
  const t = await getTranslations("Admin.finance.reports");
  const startMonth = books.startOn.slice(0, 7);
  const lastClosed = books.closedThrough?.slice(0, 7) ?? null;
  const nextToClose = lastClosed ? addMonthsTo(lastClosed, 1) : startMonth;
  const label = monthLabel(month);

  let body;
  if (month < startMonth) {
    body = (
      <p className="text-14 text-body-2">{t("beforeBooks", { day: formatDay(books.startOn) })}</p>
    );
  } else if (isClosed(books, month)) {
    body = (
      <>
        <p className="text-14 font-bold text-body-2">{t("statusClosed")}</p>
        {month === lastClosed ? (
          <ReopenMonth month={month} label={label} />
        ) : (
          <p className="text-13 text-muted">
            {t("reopenLatest", { month: monthLabel(lastClosed ?? month) })}
          </p>
        )}
      </>
    );
  } else {
    body = (
      <>
        <p className="text-14 font-bold text-body-2">{t("statusOpen")}</p>
        {month >= thisMonth ? (
          <p className="text-13 text-muted">{t("notEnded")}</p>
        ) : month === nextToClose ? (
          <CloseMonth month={month} label={label} />
        ) : (
          <p className="text-13 text-muted">
            {t("closeOrder", { month: monthLabel(nextToClose) })}
          </p>
        )}
      </>
    );
  }
  return (
    <Card
      key={`${month}-${books.closedThrough ?? ""}`}
      className="flex flex-col gap-3 p-5 print:hidden"
    >
      {body}
    </Card>
  );
}

function ReportsSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4">
      <Skeleton className="h-11 w-96" />
      <Skeleton className="h-96 rounded-card" />
      <Skeleton className="h-24 rounded-card" />
    </SkeletonGroup>
  );
}
