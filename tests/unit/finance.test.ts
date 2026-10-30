import { describe, expect, it } from "vitest";

import { AUDIT_ACTIONS } from "@/lib/admin/audit";
import { adminEditErrorFor } from "@/lib/admin/edit-errors";
import {
  ADMIN_EXPENSES_PAGE,
  adminBoxesHref,
  adminExpensesHref,
  parseAdminBoxesQuery,
  parseAdminExpensesQuery,
} from "@/lib/admin/finance-query";
import {
  expenseCategorySchema,
  expenseSchema,
  financeAccountSchema,
  parseAmount,
  transferSchema,
  voidSchema,
} from "@/lib/schemas/finance";

import ar from "../../messages/ar.json";

// Accounting (spec §8.3 A15–A17; Phase 7, task 1): the inputs, the URL
// state and the database errors the screens show.

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
    expect(parseAdminBoxesQuery({ month: "26-10", transfer: "1", from: "x" })).toEqual({
      month: undefined,
      transfer: undefined,
      from: undefined,
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
    ["22023", "same_account", "same_account"],
    ["ZL011", "reason_required", "reason_required"],
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
    ];
    for (const entity of entities) {
      expect((audit.entities as Record<string, string>)[entity]).toBeTruthy();
    }
  });
});
