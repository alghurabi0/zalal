import { describe, expect, it } from "vitest";

import {
  formatQuantity,
  parseQuantity,
  stockItemSchema,
  stockMoveSchema,
} from "@/lib/schemas/stock";

// Stock quantities (spec §8.3 A23): up to 2 decimals, typed in either digits.

describe("parseQuantity", () => {
  it.each([
    ["10", 10],
    ["2.5", 2.5],
    ["0.29", 0.29],
    ["1,250.75", 1250.75],
    ["٢٫٥", 2.5],
    [" 7 ", 7],
    ["0", 0],
  ])("reads %s", (text, value) => {
    expect(parseQuantity(text)).toBe(value);
  });

  it.each(["", "1,5", "12,34", "1.005", "-1", "abc", "1.2.3", "20000000000"])(
    "refuses %s",
    (text) => {
      expect(parseQuantity(text)).toBeNull();
    },
  );
});

describe("the schemas", () => {
  const move = {
    id: null,
    itemId: "00000000-0000-4000-8000-000000000001",
    movedOn: "2026-10-31",
    kind: "in" as const,
    quantity: 0.29,
    crewId: null,
    expenseId: null,
    note: "",
  };

  it("take two-decimal quantities that floats can't hold exactly", () => {
    for (const quantity of [0.29, 1.13, 2.01, 0.57, 4.35]) {
      expect(stockMoveSchema.safeParse({ ...move, quantity }).success).toBe(true);
    }
    expect(stockMoveSchema.safeParse({ ...move, quantity: 1.005 }).success).toBe(false);
  });

  it("keep an in above zero, a crew on an out, an expense on an in", () => {
    expect(stockMoveSchema.safeParse({ ...move, quantity: 0 }).success).toBe(false);
    expect(stockMoveSchema.safeParse({ ...move, kind: "count", quantity: 0 }).success).toBe(true);
    const crewId = "00000000-0000-4000-8000-000000000002";
    expect(stockMoveSchema.safeParse({ ...move, crewId }).success).toBe(false);
    expect(stockMoveSchema.safeParse({ ...move, kind: "out", crewId }).success).toBe(true);
    expect(stockMoveSchema.safeParse({ ...move, kind: "out", expenseId: crewId }).success).toBe(
      false,
    );
  });

  it("trim an item's name and unit", () => {
    const parsed = stockItemSchema.parse({
      id: null,
      name: " كلور ",
      unit: " كيلو ",
      minQuantity: 2.5,
      note: "",
      active: true,
    });
    expect(parsed.name).toBe("كلور");
    expect(parsed.unit).toBe("كيلو");
  });
});

describe("formatQuantity", () => {
  it("writes Western digits with groups and up to 2 decimals", () => {
    expect(formatQuantity(1250.5)).toBe("1,250.5");
    expect(formatQuantity(6)).toBe("6");
  });
});
