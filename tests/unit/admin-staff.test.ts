import { describe, expect, it } from "vitest";

import { AUDIT_ACTIONS, auditChanges, isAuditAction } from "@/lib/admin/audit";
import { ADMIN_EDIT_ERRORS, adminEditErrorFor } from "@/lib/admin/edit-errors";
import {
  addAdminSchema,
  createCrewSchema,
  removeAdminSchema,
  setCrewPhoneSchema,
  updateCrewSchema,
} from "@/lib/schemas/admin-staff";
import messages from "../../messages/ar.json";

const id = "6f1c8a52-1b0e-4c39-9f5e-2d7a8e4b3c21";

describe("admin staff schemas", () => {
  it("normalizes the phone and trims the crew name", () => {
    expect(createCrewSchema.parse({ phone: "0780 123 4567", name: "  فريق   1 " })).toEqual({
      phone: "+9647801234567",
      name: "فريق 1",
    });
  });

  it("refuses a landline, a short name and a long one", () => {
    expect(createCrewSchema.safeParse({ phone: "07801234", name: "فريق 1" }).success).toBe(false);
    expect(createCrewSchema.safeParse({ phone: "07801234567", name: "ف" }).success).toBe(false);
    expect(createCrewSchema.safeParse({ phone: "07801234567", name: "ف".repeat(31) }).success).toBe(
      false,
    );
  });

  it("needs a crew id, a name and a state to update", () => {
    expect(updateCrewSchema.safeParse({ id, name: "فريق 2", active: false }).success).toBe(true);
    expect(updateCrewSchema.safeParse({ id: "x", name: "فريق 2", active: false }).success).toBe(
      false,
    );
    expect(setCrewPhoneSchema.safeParse({ id, phone: "07701234567" }).success).toBe(true);
  });

  it("takes an admin's phone and name (2–40), and a user id to remove", () => {
    expect(addAdminSchema.parse({ phone: "+9647701234567", name: "علي" })).toEqual({
      phone: "+9647701234567",
      name: "علي",
    });
    expect(addAdminSchema.safeParse({ phone: "07701234567", name: "ع" }).success).toBe(false);
    expect(removeAdminSchema.safeParse({ userId: id }).success).toBe(true);
    expect(removeAdminSchema.safeParse({ userId: "" }).success).toBe(false);
  });
});

describe("staff errors", () => {
  it("maps the A10 and A14 codes", () => {
    expect(adminEditErrorFor({ code: "ZL019" })).toBe("phone_has_account");
    expect(adminEditErrorFor({ code: "ZL020" })).toBe("crew_name_taken");
    expect(adminEditErrorFor({ code: "ZL021" })).toBe("account_is_crew");
    expect(adminEditErrorFor({ code: "ZL022" })).toBe("cannot_remove_self");
    expect(adminEditErrorFor({ code: "P0002", message: "account_not_found" })).toBe(
      "account_deleted",
    );
    expect(adminEditErrorFor({ code: "P0002", message: "crew_not_found" })).toBe("not_found");
  });

  it("has a string for every error", () => {
    for (const error of ADMIN_EDIT_ERRORS) {
      expect(messages.Admin.editErrors[error]).toBeTruthy();
    }
  });
});

describe("auditChanges", () => {
  it("reads a single changed value", () => {
    expect(auditChanges({ from: 35000, to: 40000 })).toEqual([
      { kind: "change", field: null, from: 35000, to: 40000 },
    ]);
  });

  it("keeps the keys beside a single change", () => {
    expect(
      auditChanges({ from: "confirmed", to: "cancelled", override: false, reason: "طلب الزبون" }),
    ).toEqual([
      { kind: "change", field: null, from: "confirmed", to: "cancelled" },
      { kind: "value", field: "override", value: false },
      { kind: "value", field: "reason", value: "طلب الزبون" },
    ]);
  });

  it("reads named fields, changed or created", () => {
    expect(
      auditChanges({ phone: "+9647801234567", role: { from: "customer", to: "admin" } }),
    ).toEqual([
      { kind: "value", field: "phone", value: "+9647801234567" },
      { kind: "change", field: "role", from: "customer", to: "admin" },
    ]);
  });

  it("reads a removed crew as null", () => {
    expect(auditChanges({ from: id, to: null })).toEqual([
      { kind: "change", field: null, from: id, to: null },
    ]);
  });

  it("gives nothing for a diff that isn't an object", () => {
    expect(auditChanges(null)).toEqual([]);
    expect(auditChanges([1, 2])).toEqual([]);
  });
});

describe("audit actions", () => {
  it("has a label for every action the RPCs log", () => {
    const actions: Record<string, Record<string, string>> = messages.Admin.audit.actions;
    for (const action of AUDIT_ACTIONS) {
      const [group = "", verb = ""] = action.split(".");
      expect(actions[group]?.[verb]).toBeTruthy();
    }
    expect(isAuditAction("crew.create")).toBe(true);
    expect(isAuditAction("crew.delete")).toBe(false);
  });
});
