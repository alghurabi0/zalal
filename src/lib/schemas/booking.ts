import { z } from "zod";

import { MAX_LINE_QTY } from "@/lib/booking/draft";
import {
  bookingObjectPathPattern,
  MAX_BOOKING_FILES,
  MAX_VIDEO_SECONDS,
} from "@/lib/booking/media";

import { tankSizes, tankTypes } from "./tank";

// Booking step 3 (spec §5.11): what Checkout sends to create_order(). The
// database checks every rule again (slot, cutoff, area, uploads).

/** The longest note for the crew (Upload, spec §5.10; orders.customer_note). */
export const NOTE_MAX = 500;

const qty = z.number().int().min(1).max(MAX_LINE_QTY);

export const bookingItemSchema = z.union([
  z.object({ tankId: z.uuid(), qty }),
  z.object({ type: z.enum(tankTypes), size: z.enum(tankSizes), qty }),
]);

/** booking_availability(from, to)'s range: at most 62 days (spec §5.9's calendar). */
export const bookingDaysSchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine(({ from, to }) => {
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    return days >= 0 && days < 62;
  });
export type BookingDaysInput = z.input<typeof bookingDaysSchema>;

export const createBookingSchema = z.object({
  requestId: z.uuid(),
  addressId: z.uuid(),
  serviceDate: z.iso.date(),
  slotId: z.number().int().positive(),
  // Lines are distinct tanks; create_order() takes at most 50 (the quantities have no limit).
  items: z.array(bookingItemSchema).min(1).max(50),
  note: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(NOTE_MAX)),
  media: z
    .array(
      z.object({
        path: z.string().regex(bookingObjectPathPattern),
        durationS: z.number().min(0).max(MAX_VIDEO_SECONDS).nullable(),
      }),
    )
    .max(MAX_BOOKING_FILES),
  /** The total Checkout showed; create_order() refuses another (ZL018). */
  expectedTotal: z.number().int().min(0),
  /** Checkout's toggle: create_order() checks the address's subscription (ZL034). */
  useSubscription: z.boolean(),
});

export type CreateBookingInput = z.input<typeof createBookingSchema>;
