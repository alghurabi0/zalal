import { z } from "zod";

import {
  bookingObjectPathPattern,
  MAX_BOOKING_FILES,
  MAX_VIDEO_SECONDS,
} from "@/lib/booking/media";

import { tankSizes, tankTypes } from "./tank";

// Booking step 3 (spec §5.11): what Checkout sends to create_order(). The
// database checks every rule again (slot, cutoff, area, tank limit, uploads).

/** The longest note for the crew (Upload, spec §5.10; orders.customer_note). */
export const NOTE_MAX = 500;

const qty = z.number().int().min(1).max(20);

export const bookingItemSchema = z.union([
  z.object({ tankId: z.uuid(), qty }),
  z.object({ type: z.enum(tankTypes), size: z.enum(tankSizes), qty }),
]);

export const createBookingSchema = z.object({
  requestId: z.uuid(),
  addressId: z.uuid(),
  serviceDate: z.iso.date(),
  slotId: z.number().int().positive(),
  items: z.array(bookingItemSchema).min(1).max(20),
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
});

export type CreateBookingInput = z.input<typeof createBookingSchema>;
