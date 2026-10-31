// The accounting reports' lines (spec §8.3 A19–A20; Phase 7, task 3), shared
// by the page, the print view and the CSV download: one line per figure,
// with its value in each month of the report and the total.

/** A month of `admin_profit_and_loss`. */
export type MonthReport = {
  /** "2026-10" */
  month: string;
  ordersIqd: number;
  subscriptionsIqd: number;
  salesIqd: number;
  discountsIqd: number;
  /** Orders + subscriptions + sales − discounts. */
  revenueIqd: number;
  /** Expenses counted as paid: neither a spread purchase nor a wage paid to a worker. */
  spentIqd: number;
  /** What the workers earned (payroll), since Phase 7, task 5. */
  wagesIqd: number;
  /** The month's depreciation of equipment. */
  depreciationIqd: number;
  /** spent + wages + depreciation. */
  expensesIqd: number;
  /** Equipment sold or written off: the price less what was left (below 0, a loss). */
  equipmentResultIqd: number;
  /** Revenue − expenses + the equipment result. */
  profitIqd: number;
  receivedIqd: number;
  refundedIqd: number;
  /** Every expense paid that month, purchases and wages included. */
  paidOutIqd: number;
  /** Received − refunded − paid out. */
  netCashIqd: number;
  closed: boolean;
};

/**
 * A month's expenses in one category (`admin_expenses_by_category`): all
 * that was spent, and the part the profit counts (no spread purchases, no
 * wages paid to a worker).
 */
export type CategoryTotal = {
  month: string;
  categoryId: number;
  totalIqd: number;
  countedIqd: number;
};

export type ReportSection = "revenue" | "expenses" | "profit" | "cash";

/** The fixed figures; categories come from the books. */
export type ReportFigure =
  | "orders"
  | "subscriptions"
  | "sales"
  | "discounts"
  | "revenue"
  | "wages"
  | "depreciation"
  | "expenses"
  | "equipmentResult"
  | "profit"
  | "received"
  | "refunded"
  | "cashExpenses"
  | "netCash";

export type ReportLine = {
  section: ReportSection;
  /** A fixed figure, or an expense category by name. */
  label: { figure: ReportFigure } | { category: string };
  /** "item" lines add up to the "subtotal" or "total" under them. */
  weight: "item" | "subtotal" | "total";
  /** One value per month of the report, signed as shown (a deduction is below zero). */
  values: number[];
  total: number;
};

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
/** A deduction, shown below zero (and 0 rather than −0). */
const less = (amount: number) => (amount === 0 ? 0 : -amount);

function line(
  section: ReportSection,
  label: ReportLine["label"],
  weight: ReportLine["weight"],
  values: number[],
): ReportLine {
  return { section, label, weight, values, total: sum(values) };
}

/**
 * The profit and loss (accrual: revenue by its day, less discounts and
 * expenses) with the expenses by category, the wages earned and the
 * depreciation, then the cash section (money in and out by day). Categories,
 * wages, depreciation and the equipment result with nothing in the report's
 * months are left out, the categories largest first.
 */
export function reportLines(
  months: MonthReport[],
  byCategory: CategoryTotal[],
  categoryNames: Map<number, string>,
): ReportLine[] {
  const pick = (get: (month: MonthReport) => number) => months.map(get);
  const index = new Map(months.map((month, i) => [month.month, i]));
  const perCategory = new Map<number, number[]>();
  for (const row of byCategory) {
    const i = index.get(row.month);
    if (i === undefined || row.countedIqd === 0) continue;
    const values = perCategory.get(row.categoryId) ?? months.map(() => 0);
    values[i] = (values[i] ?? 0) + row.countedIqd;
    perCategory.set(row.categoryId, values);
  }
  const categories = [...perCategory.entries()]
    .map(([id, values]) =>
      line("expenses", { category: categoryNames.get(id) ?? String(id) }, "item", values),
    )
    .sort((a, b) => b.total - a.total);
  /** A line only when some month has something. */
  const some = (built: ReportLine) => (built.values.some((v) => v !== 0) ? [built] : []);

  return [
    line(
      "revenue",
      { figure: "orders" },
      "item",
      pick((m) => m.ordersIqd),
    ),
    line(
      "revenue",
      { figure: "subscriptions" },
      "item",
      pick((m) => m.subscriptionsIqd),
    ),
    line(
      "revenue",
      { figure: "sales" },
      "item",
      pick((m) => m.salesIqd),
    ),
    line(
      "revenue",
      { figure: "discounts" },
      "item",
      pick((m) => less(m.discountsIqd)),
    ),
    line(
      "revenue",
      { figure: "revenue" },
      "subtotal",
      pick((m) => m.revenueIqd),
    ),
    ...categories,
    ...some(
      line(
        "expenses",
        { figure: "wages" },
        "item",
        pick((m) => m.wagesIqd),
      ),
    ),
    ...some(
      line(
        "expenses",
        { figure: "depreciation" },
        "item",
        pick((m) => m.depreciationIqd),
      ),
    ),
    line(
      "expenses",
      { figure: "expenses" },
      "subtotal",
      pick((m) => m.expensesIqd),
    ),
    ...some(
      line(
        "profit",
        { figure: "equipmentResult" },
        "item",
        pick((m) => m.equipmentResultIqd),
      ),
    ),
    line(
      "profit",
      { figure: "profit" },
      "total",
      pick((m) => m.profitIqd),
    ),
    line(
      "cash",
      { figure: "received" },
      "item",
      pick((m) => m.receivedIqd),
    ),
    line(
      "cash",
      { figure: "refunded" },
      "item",
      pick((m) => less(m.refundedIqd)),
    ),
    line(
      "cash",
      { figure: "cashExpenses" },
      "item",
      pick((m) => less(m.paidOutIqd)),
    ),
    line(
      "cash",
      { figure: "netCash" },
      "total",
      pick((m) => m.netCashIqd),
    ),
  ];
}

/**
 * A CSV file Excel opens with the Arabic intact: a byte-order mark, CRLF
 * lines, fields quoted when they need it. Text starting with = + - @ is
 * prefixed with ' so a spreadsheet never runs an admin-written name as a
 * formula; numbers stay numbers.
 */
export function toCsv(rows: (string | number)[][]): string {
  const field = (value: string | number) => {
    if (typeof value === "number") return String(value);
    const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${rows.map((row) => row.map(field).join(",")).join("\r\n")}\r\n`;
}

/** The books' start day and the last closed day (null when no month is closed). */
export type FinanceBooks = { startOn: string; closedThrough: string | null };

/** The first day a new or changed record may be dated: the start day, or the day after the last closed month. */
export function firstOpenDay(books: FinanceBooks): string {
  if (!books.closedThrough || books.closedThrough < books.startOn) return books.startOn;
  const next = new Date(`${books.closedThrough}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** Whether a day ("2026-10-05") or a month ("2026-10") is closed. */
export function isClosed(books: FinanceBooks, dayOrMonth: string): boolean {
  if (!books.closedThrough) return false;
  return (dayOrMonth.length === 7 ? `${dayOrMonth}-01` : dayOrMonth) <= books.closedThrough;
}
