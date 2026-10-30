import { z } from "zod";

import { CANCEL_REASONS } from "@/lib/orders/status";

// Cancel (N6), reschedule and postpone (N7) as their Server Actions receive
// them. The database checks the order, its slot start and the new slot again
// (transition_order, spec §6).

export const cancelOrderSchema = z.object({
  orderId: z.uuid(),
  reason: z.enum(CANCEL_REASONS),
});

export type CancelOrderInput = z.input<typeof cancelOrderSchema>;

export const rescheduleOrderSchema = z.object({
  orderId: z.uuid(),
  serviceDate: z.iso.date(),
  slotId: z.number().int().positive(),
});

export type RescheduleOrderInput = z.input<typeof rescheduleOrderSchema>;

export const postponeOrderSchema = z.object({ orderId: z.uuid() });

export type PostponeOrderInput = z.input<typeof postponeOrderSchema>;

/** Orders (spec §5.12): `?tab=past&n=40`. Lists load 20 at a time. */
export const ORDERS_PAGE = 20;
export const ORDERS_MAX = 500;

export const ordersQuerySchema = z.object({
  tab: z.enum(["current", "past"]).catch("current"),
  n: z.coerce
    .number()
    .int()
    .catch(ORDERS_PAGE)
    .transform((n) => Math.min(ORDERS_MAX, Math.max(ORDERS_PAGE, n))),
});
