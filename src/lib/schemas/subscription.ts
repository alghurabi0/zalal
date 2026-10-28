import { z } from "zod";

// The subscription's inputs (spec N8, §8.2 A7, A13; Phase 6, task 2), shared
// by the forms and the Server Actions. The database checks every rule again.

export const requestSubscriptionSchema = z.object({ addressId: z.uuid() });
export type RequestSubscriptionInput = z.input<typeof requestSubscriptionSchema>;

const reason = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(1000));

/** A7 "فعّل": the plan this customer gets, prefilled from settings. */
export const activateSubscriptionSchema = z.object({
  subscriptionId: z.uuid(),
  startsOn: z.iso.date(),
  visits: z.number().int().min(1).max(12),
  tanks: z.number().int().min(1).max(6),
  priceIqd: z.number().int().min(1).max(10_000_000),
  paid: z.boolean(),
  note: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(1000)),
});
export type ActivateSubscriptionInput = z.input<typeof activateSubscriptionSchema>;

export const setSubscriptionPaidSchema = z.object({ subscriptionId: z.uuid(), paid: z.boolean() });
export type SetSubscriptionPaidInput = z.input<typeof setSubscriptionPaidSchema>;

/** + counts a visit made outside the app, − gives one back. */
export const adjustSubscriptionVisitsSchema = z.object({
  subscriptionId: z.uuid(),
  delta: z
    .number()
    .int()
    .min(-12)
    .max(12)
    .refine((value) => value !== 0),
  reason,
});
export type AdjustSubscriptionVisitsInput = z.input<typeof adjustSubscriptionVisitsSchema>;

/** Declines a request or cancels an active subscription. */
export const endSubscriptionSchema = z.object({ subscriptionId: z.uuid(), reason });
export type EndSubscriptionInput = z.input<typeof endSubscriptionSchema>;

export const addSubscriptionNoteSchema = z.object({ subscriptionId: z.uuid(), note: reason });
export type AddSubscriptionNoteInput = z.input<typeof addSubscriptionNoteSchema>;

/** A2: drop an order's coverage, or put its address's subscription on it. */
export const setOrderSubscriptionSchema = z.object({ orderId: z.uuid(), use: z.boolean() });
export type SetOrderSubscriptionInput = z.input<typeof setOrderSubscriptionSchema>;

/** A13 "الاشتراك السنوي": an empty price means not offered. */
export const subscriptionPlanSchema = z.object({
  subscription_price_iqd: z.number().int().min(1).max(10_000_000).nullable(),
  subscription_visits: z.number().int().min(1).max(12),
  subscription_tanks: z.number().int().min(1).max(6),
});
