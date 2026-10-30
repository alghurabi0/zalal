import { z } from "zod";

import { toWesternDigits } from "@/lib/phone";

// The accounting inputs (spec §8.3 A15–A17; Phase 7, task 1), shared by the
// forms and the Server Actions. The database checks every rule again: the
// day between the books' start and today, switched-off boxes and categories,
// voided records.

/** Integer IQD; the database allows up to a billion per record. */
export const AMOUNT_MAX = 1_000_000_000;
export const NOTE_MAX = 300;
export const FINANCE_NAME_MAX = 40;

export const FINANCE_ACCOUNT_KINDS = ["cash", "zain_cash", "bank", "crew"] as const;
export type FinanceAccountKind = (typeof FINANCE_ACCOUNT_KINDS)[number];
/** The kinds an admin can give a box; crew boxes come with their crew. */
export const OWN_ACCOUNT_KINDS = ["cash", "zain_cash", "bank"] as const;

export const EXPENSE_CATEGORY_KINDS = ["general", "wages", "equipment"] as const;
export type ExpenseCategoryKind = (typeof EXPENSE_CATEGORY_KINDS)[number];

const trimmed = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(max));

const name = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(2).max(FINANCE_NAME_MAX));

export const amountSchema = z.number().int().min(1).max(AMOUNT_MAX);

export const expenseSchema = z.object({
  id: z.uuid().nullable(),
  spentOn: z.iso.date(),
  categoryId: z.number().int().positive(),
  accountId: z.uuid(),
  amountIqd: amountSchema,
  note: trimmed(NOTE_MAX),
});
export type ExpenseInput = z.input<typeof expenseSchema>;

export const transferSchema = z
  .object({
    id: z.uuid().nullable(),
    movedOn: z.iso.date(),
    fromAccountId: z.uuid(),
    toAccountId: z.uuid(),
    amountIqd: amountSchema,
    note: trimmed(NOTE_MAX),
  })
  .refine((value) => value.fromAccountId !== value.toAccountId, { path: ["toAccountId"] });
export type TransferInput = z.input<typeof transferSchema>;

/** Voiding keeps the record, out of every total, with who, when and why. */
export const voidSchema = z.object({
  id: z.uuid(),
  reason: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(NOTE_MAX)),
});
export type VoidInput = z.input<typeof voidSchema>;

/** A new box (id null), or a change to one; a crew box has no name of its own. */
export const financeAccountSchema = z.object({
  id: z.uuid().nullable(),
  kind: z.enum(OWN_ACCOUNT_KINDS).nullable(),
  name: name.nullable(),
  openingBalanceIqd: z.number().int().min(-AMOUNT_MAX).max(AMOUNT_MAX),
  active: z.boolean(),
});
export type FinanceAccountInput = z.input<typeof financeAccountSchema>;

export const expenseCategorySchema = z.object({
  id: z.number().int().positive().nullable(),
  name,
  kind: z.enum(EXPENSE_CATEGORY_KINDS),
  active: z.boolean(),
});
export type ExpenseCategoryInput = z.input<typeof expenseCategorySchema>;

export const financeSettingsSchema = z.object({ startOn: z.iso.date() });
export type FinanceSettingsInput = z.input<typeof financeSettingsSchema>;

/**
 * A typed amount ("45,000", "45000", or with Arabic-Indic digits and the
 * Arabic thousands separator) as whole IQD; null when it isn't a whole
 * number. A leading minus is kept (opening balances may be below zero).
 */
export function parseAmount(text: string): number | null {
  const digits = toWesternDigits(text).replace(/[\s,\u066C]/g, "").replace(/^\u2212/, "-");
  if (!/^-?\d{1,10}$/.test(digits)) return null;
  return Number(digits);
}
