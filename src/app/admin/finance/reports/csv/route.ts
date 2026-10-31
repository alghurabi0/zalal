import { type NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

import { parseAdminReportsQuery } from "@/lib/admin/finance-query";
import { toCsv } from "@/lib/admin/finance-reports";
import { loadReport } from "@/lib/admin/report-queries";
import { getViewer } from "@/lib/auth/viewer";
import { baghdadToday, formatMonthName, formatMonthYear } from "@/lib/dates";

/**
 * A20's "تنزيل CSV" (spec §8.3 "Reports"): the report on the page, a month
 * (`?month=`) or a year (`?year=`), as a CSV file Excel opens in Arabic.
 * Admins only; the report functions refuse anyone else too.
 */
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  // A file, not a page: a lapsed session gets no file, rather than the
  // login page saved as the CSV (code review). The page itself sends the
  // admin to Login.
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (viewer.role !== "admin") return new NextResponse(null, { status: 404 });

  const t = await getTranslations({ locale: "ar", namespace: "Admin.finance.reports" });
  const query = parseAdminReportsQuery(Object.fromEntries(request.nextUrl.searchParams));
  const { year, month, months, lines } = await loadReport(query, baghdadToday());

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
