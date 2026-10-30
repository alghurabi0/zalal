"use server";

import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { requireViewer } from "@/lib/auth/viewer";
import { bookingDays, type DayOption } from "@/lib/booking/availability";
import { type BookingError, bookingErrorFor } from "@/lib/booking/errors";
import { routes } from "@/lib/routes";
import {
  type BookingDaysInput,
  bookingDaysSchema,
  type CreateBookingInput,
  createBookingSchema,
} from "@/lib/schemas/booking";
import { createClient } from "@/lib/supabase/server";

// create_order()'s OUT parameters.
const createdSchema = z.object({ order_id: z.uuid(), order_number: z.number() });

export type BookingDaysResult = { status: "ok"; days: DayOption[] } | { status: "error" };

/**
 * The open days and slots from `from` to `to` (up to 62 days), for the month
 * calendar behind "تاريخ آخر" (spec §5.9), Booking and Reschedule (N7).
 * Slots inside the cutoff are dropped by the server's clock, as on the page.
 */
export async function loadBookingDays(input: BookingDaysInput): Promise<BookingDaysResult> {
  await requireViewer(routes.book);
  const parsed = bookingDaysSchema.safeParse(input);
  if (!parsed.success) return { status: "error" };

  const supabase = await createClient();
  const [availability, settings] = await Promise.all([
    supabase.rpc("booking_availability", { p_from: parsed.data.from, p_to: parsed.data.to }),
    supabase.from("settings").select("cancel_cutoff_hours").single(),
  ]);
  if (availability.error || settings.error) {
    Sentry.captureMessage(
      `booking_availability failed (${availability.error?.code ?? settings.error?.code})`,
      "error",
    );
    return { status: "error" };
  }
  return {
    status: "ok",
    days: bookingDays(availability.data, new Date(), settings.data.cancel_cutoff_hours),
  };
}

export type CreateBookingResult =
  { status: "booked"; orderId: string } | { status: "error"; error: BookingError };

/**
 * Booking step 3 (spec §5.11, §6): creates the order as pending_confirmation
 * through create_order(), as the customer. The database re-checks the slot
 * (places and the 2 h cutoff), the service area and the uploads; a repeated requestId returns the order the first call made.
 */
export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const viewer = await requireViewer(routes.bookConfirm);
  const parsed = createBookingSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "failed" };
  const {
    requestId,
    addressId,
    serviceDate,
    slotId,
    items,
    note,
    media,
    expectedTotal,
    useSubscription,
  } = parsed.data;

  // Uploads sit in the customer's own folder; create_order() refuses any other.
  if (media.some((file) => !file.path.startsWith(`customer/${viewer.id}/`))) {
    return { status: "error", error: "upload_missing" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_order", {
      p_request_id: requestId,
      p_address_id: addressId,
      p_service_date: serviceDate,
      p_slot_id: slotId,
      p_items: items.map((item) =>
        "tankId" in item
          ? { tank_id: item.tankId, qty: item.qty }
          : { tank_type: item.type, size: item.size, qty: item.qty },
      ),
      p_note: note === "" ? undefined : note,
      p_media: media.map((file) =>
        file.durationS === null
          ? { path: file.path }
          : { path: file.path, duration_s: file.durationS },
      ),
      p_expected_total: expectedTotal,
      p_use_subscription: useSubscription,
    })
    .single();

  if (error) {
    const code = bookingErrorFor(error.code, error.message);
    // Only the SQLSTATE: the message can quote the input.
    if (code === "failed") Sentry.captureMessage(`create_order failed (${error.code})`, "error");
    return { status: "error", error: code };
  }
  const row = createdSchema.safeParse(data);
  if (!row.success) return { status: "error", error: "failed" };
  return { status: "booked", orderId: row.data.order_id };
}
