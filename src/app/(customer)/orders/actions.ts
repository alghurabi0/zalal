"use server";

import * as Sentry from "@sentry/nextjs";

import { requireViewer } from "@/lib/auth/viewer";
import { type OrderChangeError, orderChangeErrorFor } from "@/lib/orders/errors";
import { routes } from "@/lib/routes";
import {
  type CancelOrderInput,
  cancelOrderSchema,
  type PostponeOrderInput,
  postponeOrderSchema,
  type RescheduleOrderInput,
  rescheduleOrderSchema,
} from "@/lib/schemas/order";
import { createClient } from "@/lib/supabase/server";

// Cancel (N6), reschedule and postpone (N7), through transition_order() as
// the customer (spec §6). The database checks that the order is theirs, that
// it is still pending or confirmed (or postponed, for a cancel), that its
// slot hasn't started, and the new slot.

export type OrderChangeResult = { status: "done" } | { status: "error"; error: OrderChangeError };

async function transition(
  orderId: string,
  toStatus: "cancelled" | "pending_confirmation" | "postponed",
  payload: Record<string, string | number>,
): Promise<OrderChangeResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_order", {
    p_order_id: orderId,
    p_to_status: toStatus,
    p_payload: payload,
  });
  if (error) {
    const code = orderChangeErrorFor(error.code);
    // Only the SQLSTATE: the message can quote the input.
    if (code === "failed")
      Sentry.captureMessage(`transition_order failed (${error.code})`, "error");
    return { status: "error", error: code };
  }
  return { status: "done" };
}

export async function cancelOrder(input: CancelOrderInput): Promise<OrderChangeResult> {
  const parsed = cancelOrderSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "failed" };
  await requireViewer(routes.order(parsed.data.orderId));
  return transition(parsed.data.orderId, "cancelled", { cancel_reason: parsed.data.reason });
}

export async function rescheduleOrder(input: RescheduleOrderInput): Promise<OrderChangeResult> {
  const parsed = rescheduleOrderSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "failed" };
  await requireViewer(routes.order(parsed.data.orderId));
  return transition(parsed.data.orderId, "pending_confirmation", {
    service_date: parsed.data.serviceDate,
    slot_id: parsed.data.slotId,
  });
}

export async function postponeOrder(input: PostponeOrderInput): Promise<OrderChangeResult> {
  const parsed = postponeOrderSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "failed" };
  await requireViewer(routes.order(parsed.data.orderId));
  return transition(parsed.data.orderId, "postponed", {});
}
