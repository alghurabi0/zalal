import { describe, expect, it } from "vitest";

import { adminEditErrorFor } from "@/lib/admin/edit-errors";
import {
  adminExpensesHref,
  adminPayrollHref,
  parseAdminExpensesQuery,
  parseAdminPayrollQuery,
} from "@/lib/admin/finance-query";
import {
  expenseSchema,
  payrollAdjustmentSchema,
  payrollVoidSchema,
  workerDaysSchema,
  workerMoveSchema,
  workerRateSchema,
  workerSchema,
} from "@/lib/schemas/finance";
import ar from "../../messages/ar.json";

// Payroll's inputs, URLs and errors (spec §8.3 A21; Phase 7, task 4).

const workerId = "6f1c1b7e-8a39-4c8e-9a51-6d7c4b1f2e3a";

describe("workerSchema", () => {
  const worker = {
    id: null,
    name: " علي ",
    phone: "",
    note: "",
    openingBalanceIqd: 0,
    active: true,
  };
  it("trims the name and takes no phone", () => {
    expect(workerSchema.parse(worker).name).toBe("علي");
  });
  it("takes an E.164 phone and an advance below zero", () => {
    expect(
      workerSchema.safeParse({ ...worker, phone: "+9647801234567", openingBalanceIqd: -25000 })
        .success,
    ).toBe(true);
  });
  it("refuses a short name, a local phone and an amount past a billion", () => {
    expect(workerSchema.safeParse({ ...worker, name: "ع" }).success).toBe(false);
    expect(workerSchema.safeParse({ ...worker, phone: "07801234567" }).success).toBe(false);
    expect(workerSchema.safeParse({ ...worker, openingBalanceIqd: 1_000_000_001 }).success).toBe(
      false,
    );
  });
});

describe("workerRateSchema", () => {
  const rate = { workerId, effectiveOn: "2026-10-01", payType: "monthly", amountIqd: 600000 };
  it("pays something unless it is none", () => {
    expect(workerRateSchema.safeParse(rate).success).toBe(true);
    expect(workerRateSchema.safeParse({ ...rate, amountIqd: 0 }).success).toBe(false);
    expect(workerRateSchema.safeParse({ ...rate, payType: "none", amountIqd: 0 }).success).toBe(
      true,
    );
    expect(workerRateSchema.safeParse({ ...rate, payType: "none" }).success).toBe(false);
  });
});

describe("payroll records", () => {
  it("a bonus or deduction has a positive amount and a reason", () => {
    const ok = {
      workerId,
      adjustedOn: "2026-10-05",
      kind: "deduction",
      amountIqd: 2000,
      reason: "غياب",
    };
    expect(payrollAdjustmentSchema.safeParse(ok).success).toBe(true);
    expect(payrollAdjustmentSchema.safeParse({ ...ok, reason: "  " }).success).toBe(false);
    expect(payrollAdjustmentSchema.safeParse({ ...ok, amountIqd: -5 }).success).toBe(false);
    expect(payrollVoidSchema.safeParse({ id: 3, reason: "غلط" }).success).toBe(true);
  });
  it("a move may leave crews", () => {
    expect(workerMoveSchema.safeParse({ workerId, crewId: null, on: "2026-10-05" }).success).toBe(
      true,
    );
  });
  it("days worked are in their month", () => {
    const days = { workerId, month: "2026-10", days: ["2026-10-01", "2026-10-31"] };
    expect(workerDaysSchema.safeParse(days).success).toBe(true);
    expect(workerDaysSchema.safeParse({ ...days, days: ["2026-11-01"] }).success).toBe(false);
  });
  it("an expense may name the worker it pays", () => {
    const expense = {
      id: null,
      spentOn: "2026-10-05",
      categoryId: 3,
      accountId: workerId,
      amountIqd: 50000,
      note: "",
    };
    expect(expenseSchema.parse(expense).workerId).toBeUndefined();
    expect(expenseSchema.parse({ ...expense, workerId }).workerId).toBe(workerId);
  });
});

describe("payroll URLs", () => {
  it("keeps the month and the worker's drawer", () => {
    expect(adminPayrollHref({})).toBe("/admin/finance/payroll");
    expect(adminPayrollHref({ month: "2026-09", worker: workerId })).toBe(
      `/admin/finance/payroll?month=2026-09&worker=${workerId}`,
    );
    expect(parseAdminPayrollQuery({ month: "2026-13", worker: "x" })).toEqual({
      month: undefined,
      worker: undefined,
    });
  });
  it("A21's pay opens A16's new expense for the worker", () => {
    const href = adminExpensesHref({ expense: "new", worker: workerId });
    expect(href).toBe(`/admin/finance/expenses?expense=new&worker=${workerId}`);
    expect(parseAdminExpensesQuery({ expense: "new", worker: workerId }).worker).toBe(workerId);
  });
});

describe("adminEditErrorFor (payroll)", () => {
  it("maps the payroll errors", () => {
    expect(adminEditErrorFor({ code: "ZL044", message: "worker_inactive" })).toBe(
      "worker_inactive",
    );
    expect(adminEditErrorFor({ code: "ZL057", message: "worker_not_allowed" })).toBe(
      "worker_not_allowed",
    );
    expect(adminEditErrorFor({ code: "ZL058", message: "membership_overlap" })).toBe(
      "membership_overlap",
    );
    expect(adminEditErrorFor({ code: "ZL059", message: "rate_exists" })).toBe("rate_exists");
    expect(adminEditErrorFor({ code: "22023", message: "same_crew" })).toBe("same_crew");
    for (const key of [
      "worker_inactive",
      "worker_not_allowed",
      "membership_overlap",
      "rate_exists",
      "same_crew",
    ]) {
      expect((ar.Admin.editErrors as Record<string, string>)[key]).toBeTruthy();
    }
  });
  it("names the payroll areas in the audit filter", () => {
    for (const entity of ["workers", "worker_crews", "worker_rates", "payroll_adjustments"]) {
      expect((ar.Admin.audit.entities as Record<string, string>)[entity]).toBeTruthy();
    }
  });
});
