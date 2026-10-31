import { describe, expect, it } from "vitest";

import { AUDIT_ACTIONS } from "@/lib/admin/audit";
import { adminEditErrorFor } from "@/lib/admin/edit-errors";
import { adminPartnersHref, parseAdminPartnersQuery } from "@/lib/admin/finance-query";
import {
  equipmentDisposalSchema,
  expenseSchema,
  formatShare,
  parseShare,
  partnerSharesSchema,
} from "@/lib/schemas/finance";

import ar from "../../messages/ar.json";

// Partners, equipment and the balance sheet (spec §8.3 A22; Phase 7, task 5).

const a = "0f1e2d3c-4b5a-4968-8776-655443322110";
const b = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

describe("shares", () => {
  it("reads a percentage as hundredths of a percent", () => {
    expect(parseShare("66.67")).toBe(6667);
    expect(parseShare("50")).toBe(5000);
    expect(parseShare("٣٣٫٣٣")).toBe(3333);
    expect(parseShare("12,5")).toBe(1250);
    expect(parseShare("1.234")).toBeNull();
    expect(parseShare("-5")).toBeNull();
  });
  it("writes them back as people do", () => {
    expect(formatShare(6667)).toBe("66.67");
    expect(formatShare(5000)).toBe("50");
    expect(formatShare(1250)).toBe("12.5");
    expect(formatShare(5)).toBe("0.05");
  });
  it("takes a month's shares that total 100%, or none", () => {
    const set = (shares: { partnerId: string; shareBp: number }[]) =>
      partnerSharesSchema.safeParse({ month: "2026-10", shares }).success;
    expect(
      set([
        { partnerId: a, shareBp: 6667 },
        { partnerId: b, shareBp: 3333 },
      ]),
    ).toBe(true);
    expect(set([])).toBe(true);
    expect(set([{ partnerId: a, shareBp: 6000 }])).toBe(false);
    expect(
      set([
        { partnerId: a, shareBp: 5000 },
        { partnerId: a, shareBp: 5000 },
      ]),
    ).toBe(false);
  });
});

describe("equipment", () => {
  const expense = {
    id: null,
    spentOn: "2026-10-05",
    categoryId: 5,
    accountId: a,
    amountIqd: 120000,
    note: "",
  };
  it("takes a life of 1–240 months on an expense", () => {
    expect(expenseSchema.safeParse({ ...expense, usefulLifeMonths: 36 }).success).toBe(true);
    expect(expenseSchema.safeParse({ ...expense, usefulLifeMonths: 0 }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...expense, usefulLifeMonths: 241 }).success).toBe(false);
  });
  it("disposes of one item, with a sale price into a box or neither", () => {
    const disposal = {
      expenseId: a,
      openingEquipmentId: null,
      disposedOn: "2026-10-05",
      accountId: null,
      proceedsIqd: 0,
      note: "",
    };
    expect(equipmentDisposalSchema.safeParse(disposal).success).toBe(true);
    expect(equipmentDisposalSchema.safeParse({ ...disposal, openingEquipmentId: b }).success).toBe(
      false,
    );
    expect(equipmentDisposalSchema.safeParse({ ...disposal, proceedsIqd: 5000 }).success).toBe(
      false,
    );
    expect(
      equipmentDisposalSchema.safeParse({ ...disposal, proceedsIqd: 5000, accountId: b }).success,
    ).toBe(true);
  });
});

describe("A22's address and errors", () => {
  it("keeps the month and the open drawer in the URL", () => {
    expect(adminPartnersHref({ month: "2026-09", partner: a })).toBe(
      `/admin/finance/partners?month=2026-09&partner=${a}`,
    );
    expect(parseAdminPartnersQuery({ month: "bad", shares: "1", equipment: "new" })).toEqual({
      month: undefined,
      partner: undefined,
      shares: "1",
      equipment: "new",
    });
  });
  it("names the new refusals", () => {
    expect(adminEditErrorFor({ code: "ZL060", message: "life_not_allowed" })).toBe(
      "life_not_allowed",
    );
    expect(adminEditErrorFor({ code: "ZL061", message: "shares_total" })).toBe("shares_total");
    expect(adminEditErrorFor({ code: "ZL062", message: "equipment_disposed" })).toBe(
      "equipment_disposed",
    );
    expect(adminEditErrorFor({ code: "ZL044", message: "partner_inactive" })).toBe(
      "partner_inactive",
    );
    for (const key of [
      "life_not_allowed",
      "shares_total",
      "equipment_disposed",
      "partner_inactive",
    ]) {
      expect((ar.Admin.editErrors as Record<string, string>)[key]).toBeTruthy();
    }
  });
  it("labels the new audit actions and areas", () => {
    const actions = ar.Admin.audit.actions as Record<string, Record<string, string>>;
    for (const action of AUDIT_ACTIONS) {
      const [group = "", name = ""] = action.split(".");
      expect(actions[group]?.[name]).toBeTruthy();
    }
    for (const entity of [
      "partners",
      "partner_shares",
      "partner_movements",
      "opening_equipment",
      "equipment_disposals",
    ]) {
      expect((ar.Admin.audit.entities as Record<string, string>)[entity]).toBeTruthy();
    }
  });
});
