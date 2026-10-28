import { describe, expect, it } from "vitest";

import { compareVersions } from "@/lib/app-version";
import { exemptFromMaintenance } from "@/lib/routes";
import { appSettingsSchema } from "@/lib/schemas/admin-catalog";

// N16: the force-update comparison, the paths maintenance leaves open, and
// A13's "التطبيق" section.

describe("compareVersions", () => {
  it.each([
    ["0.1.0", "0.1.0", 0],
    ["0.1.0", "0.2.0", -1],
    ["1.0.0", "0.9.9", 1],
    ["0.10.0", "0.9.0", 1],
    ["1.2.3", "1.2.10", -1],
  ])("%s vs %s", (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });
});

describe("maintenance", () => {
  it.each([
    "/admin",
    "/admin/settings",
    "/crew/jobs/x",
    "/login",
    "/login/verify",
    "/terms",
    "/c/ABCDEFGH",
    "/certificates/x/print",
    "/maintenance",
  ])("leaves %s open", (path) => expect(exemptFromMaintenance(path)).toBe(true));
  it.each(["/", "/book", "/chat", "/profile", "/tips", "/welcome", "/crewmate", "/cart"])(
    "covers %s",
    (path) => expect(exemptFromMaintenance(path)).toBe(false),
  );
});

describe("A13 app section", () => {
  it("takes x.y.z only", () => {
    expect(
      appSettingsSchema.safeParse({ maintenance_mode: true, min_app_version: "1.2.0" }).success,
    ).toBe(true);
    expect(
      appSettingsSchema.safeParse({ maintenance_mode: false, min_app_version: "1.2" }).success,
    ).toBe(false);
    expect(
      appSettingsSchema.safeParse({ maintenance_mode: false, min_app_version: "v1.2.0" }).success,
    ).toBe(false);
  });
});
