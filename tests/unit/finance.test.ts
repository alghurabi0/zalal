import { describe, expect, it } from "vitest";

import { AUDIT_ACTIONS } from "@/lib/admin/audit";
import { adminEditErrorFor } from "@/lib/admin/edit-errors";
import {
  ADMIN_BOXES_PAGE,
  ADMIN_EXPENSES_PAGE,
  adminBoxesHref,
  adminExpensesHref,
  adminReportsHref,
  adminRevenueHref,
  parseAdminBoxesQuery,
  parseAdminExpensesQuery,
  parseAdminReportsQuery,
  parseAdminRevenueQuery,
} from "@/lib/admin/finance-query";
import {
  firstOpenDay,
  isClosed,
  type MonthReport,
  reportLines,
  toCsv,
} from "@/lib/admin/finance-reports";
import {
  discountSchema,
  expenseCategorySchema,
  expenseSchema,
  financeAccountSchema,
  manualSaleSchema,
  parseAmount,
  monthCloseSchema,
  monthReopenSchema,
  paymentSchema,
  transferSchema,
  voidSchema,
} from "@/lib/schemas/finance";

import ar from "../../messages/ar.json";

// Accounting (spec §8.3 A15–A18; Phase 7, tasks 1 and 2): the inputs, the
// URL state and the database errors the screens show.

const uuid = "8a6e0804-2bd0-4a3d-9f1c-2f3b1b6a9c11";
const other = "0f2b6c34-9e8d-4c55-8a1e-7d2f3e4a5b6c";

describe("parseAmount", () => {
  it("reads whole IQD typed with or without commas", () => {
    expect(parseAmount("45,000")).toBe(45000);
    expect(parseAmount(" 45000 ")).toBe(45000);
  });
  it("reads Arabic-Indic digits and the Arabic thousands separator", () => {
    expect(parseAmount("٤٥٬٠٠٠")).toBe(45000);
  });
  it("keeps a minus, for opening balances below zero", () => {
    expect(parseAmount("-20,000")).toBe(-20000);
    expect(parseAmount("−20000")).toBe(-20000);
  });
  it("refuses anything that isn't a whole number", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("12.5")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("12345678901")).toBeNull();
  });
});

describe("expenseSchema", () => {
  const expense = {
    id: null,
    spentOn: "2026-10-30",
    categoryId: 2,
    accountId: uuid,
    amountIqd: 45000,
    note: "  جلنين كلور  ",
  };
  it("accepts an expense and trims its note", () => {
    expect(expenseSchema.parse(expense).note).toBe("جلنين كلور");
  });
  it("needs an amount from 1 to a billion", () => {
    expect(expenseSchema.safeParse({ ...expense, amountIqd: 0 }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...expense, amountIqd: 1_000_000_001 }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...expense, amountIqd: 12.5 }).success).toBe(false);
  });
  it("keeps notes to 300 characters", () => {
    expect(expenseSchema.safeParse({ ...expense, note: "ا".repeat(301) }).success).toBe(false);
  });
  it("needs a day, a category and a box", () => {
    expect(expenseSchema.safeParse({ ...expense, spentOn: "30/10/2026" }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...expense, categoryId: 0 }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...expense, accountId: "" }).success).toBe(false);
  });
});

describe("transferSchema", () => {
  const transfer = {
    id: null,
    movedOn: "2026-10-30",
    fromAccountId: uuid,
    toAccountId: other,
    amountIqd: 75000,
    note: "",
  };
  it("moves money between two different boxes", () => {
    expect(transferSchema.safeParse(transfer).success).toBe(true);
    expect(transferSchema.safeParse({ ...transfer, toAccountId: uuid }).success).toBe(false);
  });
});

describe("voidSchema", () => {
  it("needs a reason", () => {
    expect(voidSchema.safeParse({ id: uuid, reason: "   " }).success).toBe(false);
    expect(voidSchema.parse({ id: uuid, reason: " انسجل مرتين " }).reason).toBe("انسجل مرتين");
  });
});

describe("financeAccountSchema and expenseCategorySchema", () => {
  it("never makes a crew box (they come with their crew)", () => {
    const box = { id: null, kind: "crew", name: "عهدة", openingBalanceIqd: 0, active: true };
    expect(financeAccountSchema.safeParse(box).success).toBe(false);
  });
  it("allows an opening balance below zero", () => {
    const box = { id: null, kind: "bank", name: "مصرف", openingBalanceIqd: -5000, active: true };
    expect(financeAccountSchema.safeParse(box).success).toBe(true);
  });
  it("names are 2 to 40 characters", () => {
    const category = { id: null, name: " ك ", kind: "general", active: true };
    expect(expenseCategorySchema.safeParse(category).success).toBe(false);
    expect(expenseCategorySchema.safeParse({ ...category, name: "كهرباء" }).success).toBe(true);
  });
});

describe("expenses URL", () => {
  it("falls back to the defaults on bad values", () => {
    expect(
      parseAdminExpensesQuery({
        month: "2026-13",
        category: "x",
        account: "1",
        n: "7",
        expense: "?",
      }),
    ).toEqual({
      month: undefined,
      category: undefined,
      account: undefined,
      q: undefined,
      voided: false,
      n: ADMIN_EXPENSES_PAGE,
      expense: undefined,
    });
  });
  it("round-trips through the href", () => {
    const query = parseAdminExpensesQuery({
      month: "2026-10",
      category: "3",
      account: uuid,
      q: " كلور ",
      voided: "1",
      expense: "new",
    });
    expect(query).toMatchObject({ month: "2026-10", category: 3, q: "كلور", voided: true });
    const href = adminExpensesHref(query);
    expect(href.startsWith("/admin/finance/expenses?")).toBe(true);
    expect(
      parseAdminExpensesQuery(Object.fromEntries(new URL(href, "http://x").searchParams)),
    ).toEqual(query);
  });
  it("is the bare page with no filters", () => {
    expect(adminExpensesHref({})).toBe("/admin/finance/expenses");
  });
});

describe("boxes URL", () => {
  it("opens a crew's handover", () => {
    const query = parseAdminBoxesQuery({ transfer: "new", from: uuid });
    expect(adminBoxesHref(query)).toBe(`/admin/finance?transfer=new&from=${uuid}`);
  });
  it("drops bad values", () => {
    expect(parseAdminBoxesQuery({ month: "26-10", transfer: "1", from: "x", n: "7" })).toEqual({
      month: undefined,
      n: ADMIN_BOXES_PAGE,
      transfer: undefined,
      from: undefined,
    });
  });
  it("shows more transfers", () => {
    expect(adminBoxesHref({ month: "2026-10", n: ADMIN_BOXES_PAGE * 2 })).toBe(
      `/admin/finance?month=2026-10&n=${ADMIN_BOXES_PAGE * 2}`,
    );
  });
});

describe("reports URL", () => {
  it("is a month by default, or a year", () => {
    expect(adminReportsHref({ month: "2026-10" })).toBe("/admin/finance/reports?month=2026-10");
    expect(adminReportsHref({ year: "2026" })).toBe("/admin/finance/reports?year=2026");
    expect(adminReportsHref({ year: "2026" }, true)).toBe("/admin/finance/reports/csv?year=2026");
  });
  it("drops bad values", () => {
    expect(parseAdminReportsQuery({ month: "2026-13", year: "26" })).toEqual({
      month: undefined,
      year: undefined,
    });
  });
});

describe("adminEditErrorFor (accounting)", () => {
  it.each([
    ["ZL042", "before_finance_start", "before_finance_start"],
    ["ZL043", "date_in_future", "date_in_future"],
    ["ZL044", "account_inactive", "account_inactive"],
    ["ZL044", "category_inactive", "category_inactive"],
    ["ZL045", "category_in_use", "expense_category_in_use"],
    ["ZL046", "records_before_start", "records_before_start"],
    ["ZL047", "record_voided", "record_voided"],
    ["ZL048", "name_taken", "name_taken"],
    ["ZL049", "payment_not_allowed", "payment_not_allowed"],
    ["ZL050", "refund_too_large", "refund_too_large"],
    ["ZL051", "discount_not_allowed", "discount_not_allowed"],
    ["ZL052", "discount_exists", "discount_exists"],
    ["ZL053", "paid_set_by_finance", "paid_set_by_finance"],
    ["22023", "same_account", "same_account"],
    ["ZL011", "reason_required", "reason_required"],
    ["ZL054", "month_closed", "month_closed"],
    ["ZL055", "close_not_allowed", "close_not_allowed"],
    ["ZL055", "reopen_not_allowed", "reopen_not_allowed"],
    ["ZL056", "books_closed", "books_closed"],
  ])("%s %s → %s", (code, message, expected) => {
    expect(adminEditErrorFor({ code, message })).toBe(expected);
  });
});

describe("audit log labels", () => {
  const audit = ar.Admin.audit;
  it("names every accounting action and area", () => {
    for (const action of AUDIT_ACTIONS) {
      const [group, key] = action.split(".") as [string, string];
      expect((audit.actions as Record<string, Record<string, string>>)[group]?.[key]).toBeTruthy();
    }
    const entities = [
      "finance_settings",
      "finance_accounts",
      "expense_categories",
      "expenses",
      "finance_transfers",
      "finance_payments",
      "finance_discounts",
      "manual_sales",
    ];
    for (const entity of entities) {
      expect((audit.entities as Record<string, string>)[entity]).toBeTruthy();
    }
  });
});

describe("paymentSchema", () => {
  const payment = {
    id: null,
    orderId: uuid,
    subscriptionId: null,
    saleId: null,
    paidOn: "2026-10-30",
    accountId: other,
    amountIqd: 35000,
    note: "  الباقي ",
  };
  it("takes a payment for one item, and a refund as a negative amount", () => {
    expect(paymentSchema.parse(payment).note).toBe("الباقي");
    expect(paymentSchema.safeParse({ ...payment, amountIqd: -5000 }).success).toBe(true);
  });
  it("refuses zero, no item or two items", () => {
    expect(paymentSchema.safeParse({ ...payment, amountIqd: 0 }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...payment, orderId: null }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...payment, saleId: other }).success).toBe(false);
  });
  it("lets an edit leave the item out", () => {
    expect(paymentSchema.safeParse({ ...payment, id: uuid, orderId: null }).success).toBe(true);
  });
});

describe("discountSchema", () => {
  const discount = {
    id: null,
    orderId: uuid,
    subscriptionId: null,
    amountIqd: 5000,
    reason: "زبون دائم",
  };
  it("needs a positive amount and a reason", () => {
    expect(discountSchema.safeParse(discount).success).toBe(true);
    expect(discountSchema.safeParse({ ...discount, amountIqd: 0 }).success).toBe(false);
    expect(discountSchema.safeParse({ ...discount, reason: "  " }).success).toBe(false);
  });
  it("is for an order or a subscription, not both", () => {
    expect(discountSchema.safeParse({ ...discount, subscriptionId: other }).success).toBe(false);
  });
});

describe("manualSaleSchema", () => {
  const sale = {
    id: null,
    soldOn: "2026-10-30",
    customerName: " موكب أبو الفضل ",
    customerPhone: "",
    service: "تنظيف 4 خزانات",
    place: "",
    amountIqd: 120000,
    crewId: null,
    note: "",
    paidAccountId: other,
  };
  it("takes a sale with an optional E.164 phone, marked paid into a box", () => {
    expect(manualSaleSchema.parse(sale).customerName).toBe("موكب أبو الفضل");
    expect(manualSaleSchema.safeParse({ ...sale, customerPhone: "+9647801234567" }).success).toBe(
      true,
    );
    expect(manualSaleSchema.safeParse({ ...sale, customerPhone: "07801234567" }).success).toBe(
      false,
    );
  });
  it("marks paid only a new sale", () => {
    expect(manualSaleSchema.safeParse({ ...sale, id: uuid }).success).toBe(false);
    expect(manualSaleSchema.safeParse({ ...sale, id: uuid, paidAccountId: null }).success).toBe(
      true,
    );
  });
});

describe("revenue URL", () => {
  it("keeps the month and the open drawer", () => {
    const query = parseAdminRevenueQuery({ month: "2026-10", payment: uuid });
    expect(adminRevenueHref(query)).toBe(`/admin/finance/revenue?month=2026-10&payment=${uuid}`);
    expect(adminRevenueHref({ sale: "new" })).toBe("/admin/finance/revenue?sale=new");
  });
  it("drops bad values", () => {
    expect(parseAdminRevenueQuery({ customer: "x", sale: "1" })).toMatchObject({
      customer: undefined,
      sale: undefined,
    });
  });
});

describe("month close", () => {
  const books = { startOn: "2026-08-10", closedThrough: "2026-09-30" };
  it("opens records the day after the last closed month", () => {
    expect(firstOpenDay(books)).toBe("2026-10-01");
    expect(firstOpenDay({ ...books, closedThrough: null })).toBe("2026-08-10");
  });
  it("knows a closed day or month", () => {
    expect(isClosed(books, "2026-09-30")).toBe(true);
    expect(isClosed(books, "2026-09")).toBe(true);
    expect(isClosed(books, "2026-10-01")).toBe(false);
    expect(isClosed(books, "2026-10")).toBe(false);
    expect(isClosed({ ...books, closedThrough: null }, "2026-08")).toBe(false);
  });
  it("closes a month and reopens it with a reason", () => {
    expect(monthCloseSchema.safeParse({ month: "2026-09" }).success).toBe(true);
    expect(monthCloseSchema.safeParse({ month: "2026-9" }).success).toBe(false);
    expect(monthReopenSchema.safeParse({ month: "2026-09", reason: "  " }).success).toBe(false);
    expect(monthReopenSchema.parse({ month: "2026-09", reason: " مصروف ناقص " }).reason).toBe(
      "مصروف ناقص",
    );
  });
});

describe("report lines", () => {
  const month = (m: string, patch: Partial<MonthReport>): MonthReport => ({
    month: m,
    ordersIqd: 0,
    subscriptionsIqd: 0,
    salesIqd: 0,
    discountsIqd: 0,
    revenueIqd: 0,
    spentIqd: 0,
    wagesIqd: 0,
    depreciationIqd: 0,
    expensesIqd: 0,
    equipmentResultIqd: 0,
    profitIqd: 0,
    receivedIqd: 0,
    refundedIqd: 0,
    paidOutIqd: 0,
    netCashIqd: 0,
    closed: false,
    ...patch,
  });
  const months = [
    month("2026-09", {
      ordersIqd: 40000,
      discountsIqd: 5000,
      revenueIqd: 35000,
      spentIqd: 8000,
      expensesIqd: 8000,
      profitIqd: 27000,
      receivedIqd: 30000,
      refundedIqd: 10000,
      paidOutIqd: 8000,
      netCashIqd: 12000,
    }),
    month("2026-10", {
      salesIqd: 9000,
      revenueIqd: 9000,
      spentIqd: 1000,
      wagesIqd: 2000,
      depreciationIqd: 500,
      expensesIqd: 3500,
      equipmentResultIqd: -300,
      profitIqd: 5200,
      paidOutIqd: 61000,
    }),
  ];
  const lines = reportLines(
    months,
    [
      { month: "2026-09", categoryId: 1, totalIqd: 3000, countedIqd: 3000 },
      { month: "2026-09", categoryId: 2, totalIqd: 5000, countedIqd: 5000 },
      { month: "2026-10", categoryId: 1, totalIqd: 1000, countedIqd: 1000 },
      // A spread purchase: paid out, but its depreciation is the profit's line.
      { month: "2026-10", categoryId: 3, totalIqd: 60000, countedIqd: 0 },
    ],
    new Map([
      [1, "وقود"],
      [2, "مواد"],
      [3, "معدات"],
    ]),
  );
  const find = (label: string) =>
    lines.find((line) =>
      "figure" in line.label ? line.label.figure === label : line.label.category === label,
    );

  it("adds each line up across the months", () => {
    expect(find("orders")).toMatchObject({ values: [40000, 0], total: 40000 });
    expect(find("profit")).toMatchObject({ values: [27000, 5200], total: 32200, weight: "total" });
  });
  it("shows deductions below zero", () => {
    expect(find("discounts")?.values).toEqual([-5000, 0]);
    expect(find("refunded")?.values).toEqual([-10000, 0]);
    expect(find("cashExpenses")?.values).toEqual([-8000, -61000]);
    expect(find("equipmentResult")?.values).toEqual([0, -300]);
  });
  it("counts wages as earned and equipment by its depreciation, not as paid", () => {
    expect(find("wages")).toMatchObject({ values: [0, 2000], section: "expenses" });
    expect(find("depreciation")).toMatchObject({ values: [0, 500], section: "expenses" });
    expect(find("معدات")).toBeUndefined();
  });
  it("leaves out wages, depreciation and the equipment result when there are none", () => {
    const plain = reportLines([months[0] as MonthReport], [], new Map());
    const figures = plain.map((line) => ("figure" in line.label ? line.label.figure : ""));
    expect(figures).not.toContain("wages");
    expect(figures).not.toContain("depreciation");
    expect(figures).not.toContain("equipmentResult");
  });
  it("lists the categories with expenses, the largest first", () => {
    const categories = lines.filter((line) => "category" in line.label);
    expect(categories.map((line) => line.total)).toEqual([5000, 4000]);
    expect(find("وقود")?.values).toEqual([3000, 1000]);
  });
  it("orders the sections: revenue, expenses, profit, cash", () => {
    const sections = lines.map((line) => line.section);
    expect([...new Set(sections)]).toEqual(["revenue", "expenses", "profit", "cash"]);
  });
});

describe("toCsv", () => {
  it("starts with a byte-order mark and ends lines with CRLF", () => {
    expect(
      toCsv([
        ["البند", "المبلغ"],
        ["الربح", 1000],
      ]),
    ).toBe("\uFEFFالبند,المبلغ\r\nالربح,1000\r\n");
  });
  it("quotes commas and quotes, and keeps a name from running as a formula", () => {
    expect(toCsv([['وقود، "بانزين", نقل', "=SUM(A1)", -500]])).toBe(
      '\uFEFF"وقود، ""بانزين"", نقل",\'=SUM(A1),-500\r\n',
    );
  });
});
