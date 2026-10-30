import { type NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

import { expenseCategories } from "@/lib/admin/finance-queries";
import { parseAdminReportsQuery } from "@/lib/admin/finance-query";
import { reportLines, toCsv } from "@/lib/admin/finance-reports";
import { expensesByCategory, profitAndLoss } from "@/lib/admin/report-queries";
import { getViewer } from "@/lib/auth/viewer";
import { baghdadToday, formatMonthName, formatMonthYear } from "@/lib/dates";
import { routes, withNext } from "@/lib/routes";

/**
 * A20's "تنزيل CSV" (spec §8.3 "Reports"): the report on the page, a month
 * (`?month=`) or a year (`?year=`), as a CSV file Excel opens in Arabic.
 * Admins only; the report functions refuse anyone else too.
 */
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.redirect(
      new URL(withNext(routes.login, routes.adminFinanceReports), request.url),
      303,
    );
  }
  if (viewer.role !== "admin") return new NextResponse(null, { status: 404 });

  const t = await getTranslations({ locale: "ar", namespace: "Admin.finance.reports" });
  const query = parseAdminReportsQuery(Object.fromEntries(request.nextUrl.searchParams));
  const today = baghdadToday();
  const year = query.year && query.year <= today.slice(0, 4) ? query.year : null;
  const month =
    !year && query.month && query.month <= today.slice(0, 7) ? query.month : today.slice(0, 7);
  const [from, to] = year ? [`${year}-01`, `${year}-12`] : [month, month];
  const [months, byCategory, categories] = await Promise.all([
    profitAndLoss(from, to),
    expensesByCategory(from, to),
    expenseCategories(),
  ]);
  const lines = reportLines(
    months,
    byCategory,
    new Map(categories.map((category) => [category.id, category.name])),
  );

  const header = year
    ? [
        t("columns.line"),
        ...months.map((m) => formatMonthName(`${m.month}-15`)),
        t("columns.total"),
      ]
    : [t("columns.line"), formatMonthYear(`${month}-15T12:00:00Z`)];
  const rows: (string | number)[][] = [header];
  let section: string | null = null;
  for (const line of lines) {
    if (line.section !== section && line.section !== "profit") {
      rows.push([t(`sections.${line.section}`)]);
    }
    section = line.section;
    const label = "figure" in line.label ? t(`figures.${line.label.figure}`) : line.label.category;
    rows.push([label, ...(year ? [...line.values, line.total] : [line.total])]);
  }

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="zalal-report-${year ?? month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
