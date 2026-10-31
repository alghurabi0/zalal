import { useTranslations } from "next-intl";

import { Money } from "@/components/admin/finance";
import { formatMonthName } from "@/lib/dates";
import type { MonthReport } from "@/lib/admin/finance-reports";

// The overview's charts (spec §8.3 A19): plain bars in the theme's chart
// tokens, each with its numbers in text beside or under it, so nothing is
// read from color alone and a table carries every value.

/**
 * Revenue and expenses for each month, side by side from the baseline, the
 * profit under each pair, then the same numbers as a table.
 */
export function MonthBars({ months }: { months: MonthReport[] }) {
  const t = useTranslations("Admin.finance.overview");
  const max = Math.max(1, ...months.flatMap((m) => [m.revenueIqd, m.expensesIqd]));
  const height = (amount: number) => `${Math.max(0, (amount / max) * 100)}%`;
  return (
    <figure className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4 text-13 text-body-2" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-4 bg-chart-revenue" />
          {t("revenue")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-4 bg-chart-expense" />
          {t("expenses")}
        </span>
      </div>
      <div className="grid grid-cols-6 gap-2" aria-hidden>
        {months.map((month) => (
          <div key={month.month} className="flex flex-col items-center gap-1.5">
            <div className="flex h-36 w-full items-end justify-center gap-0.5 border-b border-track">
              <span
                className="w-4 rounded-t-4 bg-chart-revenue"
                style={{ height: height(month.revenueIqd) }}
                title={`${t("revenue")}: ${month.revenueIqd}`}
              />
              <span
                className="w-4 rounded-t-4 bg-chart-expense"
                style={{ height: height(month.expensesIqd) }}
                title={`${t("expenses")}: ${month.expensesIqd}`}
              />
            </div>
            <span className="text-12 font-bold text-muted">
              {formatMonthName(`${month.month}-15`)}
            </span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-md text-13">
          <caption className="sr-only">{t("chartCaption")}</caption>
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-1.5 text-start font-bold">
                {t("month")}
              </th>
              <th scope="col" className="py-1.5 text-start font-bold">
                {t("revenue")}
              </th>
              <th scope="col" className="py-1.5 text-start font-bold">
                {t("expenses")}
              </th>
              <th scope="col" className="py-1.5 text-start font-bold">
                {t("profit")}
              </th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.month} className="border-t border-divider">
                <th scope="row" className="py-1.5 text-start font-bold">
                  {formatMonthName(`${month.month}-15`)}
                </th>
                <td className="py-1.5">
                  <Money amount={month.revenueIqd} />
                </td>
                <td className="py-1.5">
                  <Money amount={month.expensesIqd} />
                </td>
                <td className="py-1.5">
                  <Money amount={month.profitIqd} className="font-extrabold" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** Where the money went: each category's share of the month's expenses, largest first. */
export function CategoryBars({ rows }: { rows: { name: string; totalIqd: number }[] }) {
  const t = useTranslations("Admin.finance.overview");
  const total = rows.reduce((sum, row) => sum + row.totalIqd, 0);
  const max = Math.max(1, ...rows.map((row) => row.totalIqd));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.name} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-14">
            <span className="font-bold">{row.name}</span>
            <span className="flex items-baseline gap-2">
              <Money amount={row.totalIqd} className="font-extrabold" />
              <span className="text-12 text-muted">
                {t("share", { percent: Math.round((row.totalIqd / total) * 100) })}
              </span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-well" aria-hidden>
            <div
              className="h-2 rounded-full bg-chart-expense"
              style={{ width: `${(row.totalIqd / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
