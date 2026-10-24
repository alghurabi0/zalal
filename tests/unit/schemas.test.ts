import { describe, expect, it } from "vitest";

import { addressInputSchema } from "@/lib/schemas/address";
import { nameInputSchema } from "@/lib/schemas/profile";
import { tankInputSchema } from "@/lib/schemas/tank";

describe("Name (N1)", () => {
  it("trims and collapses spaces, 2–40 characters", () => {
    expect(nameInputSchema.parse({ fullName: "  أحمد   علي " }).fullName).toBe("أحمد علي");
    expect(nameInputSchema.safeParse({ fullName: " ا " }).success).toBe(false);
    expect(nameInputSchema.safeParse({ fullName: "ا".repeat(41) }).success).toBe(false);
  });
});

describe("Address (Location)", () => {
  const valid = {
    label: "home",
    district: " حي  الحسين ",
    landmark: "قرب جامع الحسين",
    lat: "32.6165",
    lng: "44.0324",
  };

  it("parses form values", () => {
    expect(addressInputSchema.parse(valid)).toEqual({
      label: "home",
      district: "حي الحسين",
      landmark: "قرب جامع الحسين",
      lat: 32.6165,
      lng: 44.0324,
    });
  });

  it("names the field and the problem", () => {
    const result = addressInputSchema.safeParse({
      ...valid,
      district: "ح",
      landmark: "x".repeat(121),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => [i.path[0], i.message])).toEqual([
      ["district", "too_short"],
      ["landmark", "too_long"],
    ]);
  });

  it.each([{ label: "office" }, { lat: "100" }, { lng: "abc" }])("refuses %j", (change) => {
    expect(addressInputSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});

describe("Tank (N3)", () => {
  const valid = {
    addressId: "6f1c1f0e-2b0a-4c47-9a53-3a8d1f3f9e11",
    type: "roof",
    size: "m",
  };

  it("saves an empty nickname as none", () => {
    expect(tankInputSchema.parse({ ...valid, nickname: "  " }).nickname).toBeNull();
    expect(tankInputSchema.parse(valid).nickname).toBeNull();
    expect(tankInputSchema.parse({ ...valid, nickname: " خزان  المطبخ " }).nickname).toBe(
      "خزان المطبخ",
    );
  });

  it.each([
    { type: "basement" },
    { size: "xl" },
    { addressId: "nope" },
    { nickname: "x".repeat(31) },
  ])("refuses %j", (change) => {
    expect(tankInputSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});
