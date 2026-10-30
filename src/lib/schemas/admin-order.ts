import { z } from "zod";

import { ORDER_STATUSES } from "@/lib/admin/orders-query";

// The A2 drawer's actions as their Server Actions receive them (spec §6,
// §8.2). The database checks the move, the slot and the crew again
// (transition_order, assign_crew).

/** Staff reasons go to order_event_notes (1–500 characters, trimmed). */
export const STAFF_NOTE_MAX = 500;
export const staffReasonSchema = z.string().trim().min(1).max(STAFF_NOTE_MAX);

export const confirmOrderSchema = z.object({
  orderId: z.uuid(),
  /** Then assign this crew; left out, the current crew (or none) stays. */
  crewId: z.uuid().optional(),
});

export const assignCrewSchema = z.object({
  orderId: z.uuid(),
  /** Null removes the crew. */
  crewId: z.uuid().nullable(),
});

export const adminCancelSchema = z.object({ orderId: z.uuid(), reason: staffReasonSchema });

export const adminNoShowSchema = z.object({ orderId: z.uuid(), reason: staffReasonSchema });

/** Postponing takes an optional note (blank = none). */
export const adminPostponeSchema = z.object({
  orderId: z.uuid(),
  reason: z
    .string()
    .trim()
    .max(STAFF_NOTE_MAX)
    .transform((value) => value || undefined)
    .optional(),
});

export const adminRescheduleSchema = z.object({
  orderId: z.uuid(),
  serviceDate: z.iso.date(),
  slotId: z.number().int().positive(),
});

export const overrideSchema = z.object({
  orderId: z.uuid(),
  toStatus: z.enum(ORDER_STATUSES),
  reason: staffReasonSchema,
});

export type ConfirmOrderInput = z.input<typeof confirmOrderSchema>;
export type AssignCrewInput = z.input<typeof assignCrewSchema>;
export type AdminCancelInput = z.input<typeof adminCancelSchema>;
export type AdminNoShowInput = z.input<typeof adminNoShowSchema>;
export type AdminPostponeInput = z.input<typeof adminPostponeSchema>;
export type AdminRescheduleInput = z.input<typeof adminRescheduleSchema>;
export type OverrideInput = z.input<typeof overrideSchema>;
