import { z } from "zod";

import { toWesternDigits } from "@/lib/phone";

import { NOTE_MAX } from "./finance";

// Stock (spec §8.3 A23; Phase 7, task 6), shared by the forms and the Server
// Actions. Quantities only, with up to 2 decimals (chlorine by the kilo).
// The database checks every rule again: the day, switched-off items, a
// quantity never below zero, one count a day, and the linked expense.

export const STOCK_NAME_MAX = 60;
export const STOCK_UNIT_MAX = 20;
export const QUANTITY_MAX = 1_000_000_000;

export const STOCK_MOVE_KINDS = ["in", "out", "count"] as const;
export type StockMoveKind = (typeof STOCK_MOVE_KINDS)[number];

/** 0 up to a billion, in hundredths. */
const quantity = z
  .number()
  .min(0)
  .max(QUANTITY_MAX)
  .refine((value) => Number(value.toFixed(2)) === value);

const trimmed = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(min).max(max));

export const stockItemSchema = z.object({
  id: z.uuid().nullable(),
  name: trimmed(2, STOCK_NAME_MAX),
  unit: trimmed(1, STOCK_UNIT_MAX),
  minQuantity: quantity,
  note: trimmed(0, NOTE_MAX),
  active: z.boolean(),
});
export type StockItemInput = z.input<typeof stockItemSchema>;

export const stockMoveSchema = z
  .object({
    id: z.uuid().nullable(),
    itemId: z.uuid(),
    movedOn: z.iso.date(),
    kind: z.enum(STOCK_MOVE_KINDS),
    quantity,
    crewId: z.uuid().nullable(),
    expenseId: z.uuid().nullable(),
    note: trimmed(0, NOTE_MAX),
  })
  .refine((m) => m.kind === "count" || m.quantity > 0, { path: ["quantity"] })
  .refine((m) => m.crewId === null || m.kind === "out", { path: ["crewId"] })
  .refine((m) => m.expenseId === null || m.kind === "in", { path: ["expenseId"] });
export type StockMoveInput = z.input<typeof stockMoveSchema>;

/**
 * A quantity as typed: either digits, "." or the Arabic decimal mark
 * (U+066B), up to 2 decimals, with commas only as thousands separators
 * ("1,5" is refused, not read as 15); null otherwise.
 */
export function parseQuantity(text: string): number | null {
  const digits = toWesternDigits(text.trim())
    .replace(/\u066C/g, ",")
    .replace(/\u066B/g, ".");
  if (!/^(\d{1,10}|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(digits)) return null;
  const value = Number(digits.replace(/,/g, ""));
  return value <= QUANTITY_MAX ? value : null;
}

export { formatQuantity } from "@/lib/quantity";
