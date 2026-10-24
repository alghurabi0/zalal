import { describe, expect, it } from "vitest";

import { afterLogin, afterName } from "@/lib/auth/destination";
import { requiresLogin, safeNext, withNext } from "@/lib/routes";

describe("safeNext", () => {
  it.each(["/", "/tanks", "/addresses/new?onboarding=1", "/book?step=2#x"])(
    "keeps the site path %j",
    (value) => {
      expect(safeNext(value)).toBe(value.replace(/#.*$/, ""));
    },
  );

  it.each([
    "https://evil.example/",
    "//evil.example/x",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "tanks",
    "/tanks\n",
    "/login",
    "/login/verify",
    "/welcome",
    "",
    null,
    undefined,
    42,
    `/${"a".repeat(600)}`,
  ])("refuses %j", (value) => {
    expect(safeNext(value)).toBeNull();
  });
});

describe("withNext", () => {
  it("adds next, encoded, unless it is Home or missing", () => {
    expect(withNext("/login", "/tanks")).toBe("/login?next=%2Ftanks");
    expect(withNext("/addresses/new?onboarding=1", "/book")).toBe(
      "/addresses/new?onboarding=1&next=%2Fbook",
    );
    expect(withNext("/login", "/")).toBe("/login");
    expect(withNext("/login", null)).toBe("/login");
  });
});

describe("requiresLogin", () => {
  it.each(["/profile", "/tanks", "/addresses/new", "/onboarding/name", "/crew", "/admin/x"])(
    "%s needs a login",
    (path) => expect(requiresLogin(path)).toBe(true),
  );

  it.each(["/", "/welcome", "/login", "/login/verify", "/terms", "/kit", "/profiles", "/tanksx"])(
    "%s is open to guests",
    (path) => expect(requiresLogin(path)).toBe(false),
  );
});

describe("afterLogin (spec §2, §5.3)", () => {
  const base = { role: "customer", isNewUser: false, hasAddress: true, next: null } as const;

  it("sends crew and admins to their surface, whatever next says", () => {
    expect(afterLogin({ ...base, role: "crew", next: "/tanks" })).toBe("/crew");
    expect(afterLogin({ ...base, role: "admin", isNewUser: true })).toBe("/admin");
  });

  it("sends a new customer to Name, keeping next", () => {
    expect(afterLogin({ ...base, isNewUser: true, hasAddress: false, next: "/book" })).toBe(
      "/onboarding/name?next=%2Fbook",
    );
  });

  it("sends a customer without an address to Location in onboarding mode", () => {
    expect(afterLogin({ ...base, hasAddress: false })).toBe("/addresses/new?onboarding=1");
    expect(afterLogin({ ...base, hasAddress: false, next: "/book" })).toBe(
      "/addresses/new?onboarding=1&next=%2Fbook",
    );
  });

  it("sends everyone else to next, or Home", () => {
    expect(afterLogin({ ...base, next: "/tanks" })).toBe("/tanks");
    expect(afterLogin(base)).toBe("/");
    expect(afterLogin({ ...base, next: "https://evil.example" })).toBe("/");
  });
});

describe("afterName", () => {
  it("goes to Location without an address, else onward", () => {
    expect(afterName({ hasAddress: false, next: null })).toBe("/addresses/new?onboarding=1");
    expect(afterName({ hasAddress: true, next: "/tanks" })).toBe("/tanks");
    expect(afterName({ hasAddress: true, next: "//evil" })).toBe("/");
  });
});
