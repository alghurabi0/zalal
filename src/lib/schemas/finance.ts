import { z } from "zod";

import { toWesternDigits } from "@/lib/phone";

// The accounting inputs (spec §8.3; Phase 7, tasks 1 and 2), shared by the
// forms and the Server Actions. The database checks every rule again: the
// day between the books' start and today, switched-off boxes and categories,
// voided records, refunds and discounts.

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
  /** The worker a wage pays (payroll, task 4); only on a wages category. */
  workerId: z.uuid().nullable().optional(),
  /** A purchase in an equipment category, spread over this many months (task 5). */
  usefulLifeMonths: z.number().int().min(1).max(240).nullable().optional(),
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

/**
 * A payment (Phase 7, task 2): money in for one order, subscription or
 * manual sale, or out when negative (a refund). An edit keeps its item.
 */
export const paymentSchema = z
  .object({
    id: z.uuid().nullable(),
    orderId: z.uuid().nullable(),
    subscriptionId: z.uuid().nullable(),
    saleId: z.uuid().nullable(),
    paidOn: z.iso.date(),
    accountId: z.uuid(),
    amountIqd: z
      .number()
      .int()
      .min(-AMOUNT_MAX)
      .max(AMOUNT_MAX)
      .refine((value) => value !== 0),
    note: trimmed(NOTE_MAX),
  })
  .refine(
    (value) =>
      value.id !== null ||
      [value.orderId, value.subscriptionId, value.saleId].filter(Boolean).length === 1,
    { path: ["orderId"] },
  );
export type PaymentInput = z.input<typeof paymentSchema>;

/** A discount on an order or a subscription, in the books only, with a reason. */
export const discountSchema = z
  .object({
    id: z.uuid().nullable(),
    orderId: z.uuid().nullable(),
    subscriptionId: z.uuid().nullable(),
    amountIqd: amountSchema,
    reason: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1).max(NOTE_MAX)),
  })
  .refine(
    (value) =>
      value.id !== null || [value.orderId, value.subscriptionId].filter(Boolean).length === 1,
    { path: ["orderId"] },
  );
export type DiscountInput = z.input<typeof discountSchema>;

export const SALE_NAME_MAX = 80;
export const SALE_SERVICE_MAX = 120;
export const SALE_PLACE_MAX = 120;

/**
 * Work outside the app (phone bookings, hotels and مواكب, outside Karbala).
 * The phone is E.164 or empty; `paidAccountId` (a new sale only) records the
 * whole amount as paid into that box.
 */
export const manualSaleSchema = z
  .object({
    id: z.uuid().nullable(),
    soldOn: z.iso.date(),
    customerName: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(2).max(SALE_NAME_MAX)),
    customerPhone: z.union([z.literal(""), z.string().regex(/^\+9647[3-9][0-9]{8}$/)]),
    service: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(2).max(SALE_SERVICE_MAX)),
    place: trimmed(SALE_PLACE_MAX),
    amountIqd: amountSchema,
    crewId: z.uuid().nullable(),
    note: trimmed(NOTE_MAX),
    paidAccountId: z.uuid().nullable(),
  })
  .refine((value) => value.id === null || value.paidAccountId === null, {
    path: ["paidAccountId"],
  });
export type ManualSaleInput = z.input<typeof manualSaleSchema>;

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

/** The category A17 deletes. */
export const expenseCategoryIdSchema = z.number().int().positive();

export const financeSettingsSchema = z.object({ startOn: z.iso.date() });
export type FinanceSettingsInput = z.input<typeof financeSettingsSchema>;

/** A20's month close: "2026-10". Reopening takes a reason too. */
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const monthCloseSchema = z.object({ month });
export type MonthCloseInput = z.input<typeof monthCloseSchema>;
export const monthReopenSchema = z.object({
  month,
  reason: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(NOTE_MAX)),
});
export type MonthReopenInput = z.input<typeof monthReopenSchema>;

// Payroll (Phase 7, task 4; A21). ------------------------------------------------------------

export const WORKER_NAME_MAX = 60;
export const WORKER_PAY_TYPES = ["per_visit", "per_day", "monthly", "none"] as const;
export type WorkerPayType = (typeof WORKER_PAY_TYPES)[number];
export const PAYROLL_ADJUSTMENT_KINDS = ["bonus", "deduction"] as const;
export type PayrollAdjustmentKind = (typeof PAYROLL_ADJUSTMENT_KINDS)[number];

const reason = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(NOTE_MAX));

/** A worker: internal records for the books, no login. The phone is E.164 or empty. */
export const workerSchema = z.object({
  id: z.uuid().nullable(),
  name: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(2).max(WORKER_NAME_MAX)),
  phone: z.union([z.literal(""), z.string().regex(/^\+9647[3-9][0-9]{8}$/)]),
  note: trimmed(NOTE_MAX),
  openingBalanceIqd: z.number().int().min(-AMOUNT_MAX).max(AMOUNT_MAX),
  active: z.boolean(),
});
export type WorkerInput = z.input<typeof workerSchema>;

/** From `on`, the worker is in `crewId` (null: in no crew). */
export const workerMoveSchema = z.object({
  workerId: z.uuid(),
  crewId: z.uuid().nullable(),
  on: z.iso.date(),
});
export type WorkerMoveInput = z.input<typeof workerMoveSchema>;

/** A membership row, a rate or a bonus by its id. */
export const payrollIdSchema = z.number().int().positive();

/** A rate from its day; "none" pays nothing, every other type something. */
export const workerRateSchema = z
  .object({
    workerId: z.uuid(),
    effectiveOn: z.iso.date(),
    payType: z.enum(WORKER_PAY_TYPES),
    amountIqd: z.number().int().min(0).max(AMOUNT_MAX),
  })
  .refine((value) => (value.payType === "none") === (value.amountIqd === 0), {
    path: ["amountIqd"],
  });
export type WorkerRateInput = z.input<typeof workerRateSchema>;

export const payrollAdjustmentSchema = z.object({
  workerId: z.uuid(),
  adjustedOn: z.iso.date(),
  kind: z.enum(PAYROLL_ADJUSTMENT_KINDS),
  amountIqd: amountSchema,
  reason,
});
export type PayrollAdjustmentInput = z.input<typeof payrollAdjustmentSchema>;

/** Voiding a rate or a bonus (their ids are numbers). */
export const payrollVoidSchema = z.object({ id: payrollIdSchema, reason });
export type PayrollVoidInput = z.input<typeof payrollVoidSchema>;

/** The month's ticked days ("2026-10"), each in that month. */
export const workerDaysSchema = z
  .object({
    workerId: z.uuid(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    days: z.array(z.iso.date()).max(31),
  })
  .refine((value) => value.days.every((day) => day.startsWith(`${value.month}-`)), {
    path: ["days"],
  });
export type WorkerDaysInput = z.input<typeof workerDaysSchema>;

/**
 * A typed amount ("45,000", "45000", or with Arabic-Indic digits and the
 * Arabic thousands separator) as whole IQD; null when it isn't a whole
 * number. A leading minus is kept (opening balances may be below zero).
 */
export function parseAmount(text: string): number | null {
  const digits = toWesternDigits(text)
    .replace(/[\s,\u066C]/g, "")
    .replace(/^\u2212/, "-");
  if (!/^-?\d{1,10}$/.test(digits)) return null;
  return Number(digits);
}

// Partners, equipment and the balance sheet (Phase 7, task 5; A22). ---------------------------

export const PARTNER_NAME_MAX = 60;
export const EQUIPMENT_NAME_MAX = 60;
/** Months a purchase is spread over: 1–240; A16 suggests 36. */
export const LIFE_MAX = 240;
export const DEFAULT_LIFE_MONTHS = 36;
/** A share in hundredths of a percent: 10000 is all of it. */
export const SHARES_TOTAL = 10000;
export const PARTNER_MOVEMENT_KINDS = ["capital", "withdrawal"] as const;
export type PartnerMovementKind = (typeof PARTNER_MOVEMENT_KINDS)[number];

const life = z.number().int().min(1).max(LIFE_MAX);

/** A partner: a record in the books, no login. The phone is E.164 or empty. */
export const partnerSchema = z.object({
  id: z.uuid().nullable(),
  name: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(2).max(PARTNER_NAME_MAX)),
  phone: z.union([z.literal(""), z.string().regex(/^\+9647[3-9][0-9]{8}$/)]),
  note: trimmed(NOTE_MAX),
  openingCapitalIqd: z.number().int().min(-AMOUNT_MAX).max(AMOUNT_MAX),
  active: z.boolean(),
});
export type PartnerInput = z.input<typeof partnerSchema>;

/** A month's shares ("2026-10"): each partner's in hundredths of a percent, 100% in all, or none. */
export const partnerSharesSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    shares: z
      .array(z.object({ partnerId: z.uuid(), shareBp: z.number().int().min(1).max(SHARES_TOTAL) }))
      .max(50),
  })
  .refine(
    (value) =>
      value.shares.length === 0 ||
      value.shares.reduce((total, share) => total + share.shareBp, 0) === SHARES_TOTAL,
    { path: ["shares"] },
  )
  .refine((value) => new Set(value.shares.map((s) => s.partnerId)).size === value.shares.length, {
    path: ["shares"],
  });
export type PartnerSharesInput = z.input<typeof partnerSharesSchema>;

export const partnerMovementSchema = z.object({
  id: z.uuid().nullable(),
  partnerId: z.uuid(),
  movedOn: z.iso.date(),
  kind: z.enum(PARTNER_MOVEMENT_KINDS),
  accountId: z.uuid(),
  amountIqd: amountSchema,
  note: trimmed(NOTE_MAX),
});
export type PartnerMovementInput = z.input<typeof partnerMovementSchema>;

/** What the company owned at the books' start: its value then and the months left. */
export const openingEquipmentSchema = z.object({
  id: z.uuid().nullable(),
  name: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(2).max(EQUIPMENT_NAME_MAX)),
  valueIqd: amountSchema,
  monthsLeft: life,
  note: trimmed(NOTE_MAX),
});
export type OpeningEquipmentInput = z.input<typeof openingEquipmentSchema>;

/** A write-off of a purchase or opening equipment, with a sale price into a box or neither. */
export const equipmentDisposalSchema = z
  .object({
    expenseId: z.uuid().nullable(),
    openingEquipmentId: z.uuid().nullable(),
    disposedOn: z.iso.date(),
    accountId: z.uuid().nullable(),
    proceedsIqd: z.number().int().min(0).max(AMOUNT_MAX),
    note: trimmed(NOTE_MAX),
  })
  .refine((value) => (value.expenseId === null) !== (value.openingEquipmentId === null), {
    path: ["expenseId"],
  })
  .refine((value) => value.proceedsIqd > 0 === (value.accountId !== null), {
    path: ["accountId"],
  });
export type EquipmentDisposalInput = z.input<typeof equipmentDisposalSchema>;

/**
 * A typed percentage ("66.67", "66,67" or Arabic-Indic digits) as hundredths
 * of a percent; null unless it has at most two decimals.
 */
export function parseShare(text: string): number | null {
  const digits = toWesternDigits(text)
    .trim()
    .replace(/[\u066B,]/, ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(digits)) return null;
  const [whole = "0", fraction = ""] = digits.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Hundredths of a percent as people write it: 6667 → "66.67", 5000 → "50". */
export function formatShare(shareBp: number): string {
  const whole = Math.floor(shareBp / 100);
  const fraction = shareBp % 100;
  return fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}
