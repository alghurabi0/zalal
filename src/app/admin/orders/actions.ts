"use server";

import * as Sentry from "@sentry/nextjs";
import type { z } from "zod";

import { type AdminEditResult, editFailure } from "@/lib/admin/edit-errors";
import { type AdminOrderError, adminOrderErrorFor } from "@/lib/admin/errors";
import { requireViewer } from "@/lib/auth/viewer";
import type { Json } from "@/lib/database.types";
import { routes } from "@/lib/routes";
import {
  type AdminCancelInput,
  adminCancelSchema,
  type AdminNoShowInput,
  adminNoShowSchema,
  type AdminPostponeInput,
  adminPostponeSchema,
  type AdminRescheduleInput,
  adminRescheduleSchema,
  type AssignCrewInput,
  assignCrewSchema,
  type ConfirmOrderInput,
  confirmOrderSchema,
  type OverrideInput,
  overrideSchema,
} from "@/lib/schemas/admin-order";
import {
  type SetOrderSubscriptionInput,
  setOrderSubscriptionSchema,
} from "@/lib/schemas/subscription";
import { createClient } from "@/lib/supabase/server";

// The A2 drawer's actions (spec §6, §8.2), as the admin: transition_order()
// for status changes, assign_crew() for the crew and
// admin_set_order_subscription() for its coverage. Each checks the role,
// writes the audit log and keeps staff reasons internal.

export type AdminOrderResult = { status: "done" } | { status: "error"; error: AdminOrderError };

type OrderStatus = z.infer<typeof overrideSchema>["toStatus"];

function failure(rpc: string, error: { code?: string; message?: string }): AdminOrderResult {
  const code = adminOrderErrorFor(error);
  // Only the SQLSTATE: the message can quote the input.
  if (code === "failed") Sentry.captureMessage(`${rpc} failed (${error.code})`, "error");
  return { status: "error", error: code };
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function admin(orderId: string): Promise<Client> {
  await requireViewer(routes.adminOrder(orderId), "admin");
  return createClient();
}

async function transitionWith(
  supabase: Client,
  orderId: string,
  toStatus: OrderStatus,
  payload: { [key: string]: Json },
): Promise<AdminOrderResult> {
  const { error } = await supabase.rpc("transition_order", {
    p_order_id: orderId,
    p_to_status: toStatus,
    p_payload: payload,
  });
  return error ? failure("transition_order", error) : { status: "done" };
}

async function assignWith(
  supabase: Client,
  orderId: string,
  crewId: string | null,
): Promise<AdminOrderResult> {
  const { error } = await supabase.rpc("assign_crew", {
    p_order_id: orderId,
    // The generated type says string; the function takes null to remove the crew.
    p_crew_id: crewId as string,
  });
  return error ? failure("assign_crew", error) : { status: "done" };
}

async function transition(
  orderId: string,
  toStatus: OrderStatus,
  payload: { [key: string]: Json },
): Promise<AdminOrderResult> {
  return transitionWith(await admin(orderId), orderId, toStatus, payload);
}

/**
 * Confirms, then assigns the chosen crew. Confirming first means a stale
 * drawer (someone else moved the order) changes nothing. If the crew can't
 * be assigned, the order stays confirmed and the error says why.
 */
export async function confirmOrder(input: ConfirmOrderInput): Promise<AdminOrderResult> {
  const parsed = confirmOrderSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "failed" };
  const { orderId, crewId } = parsed.data;
  const supabase = await admin(orderId);
  const confirmed = await transitionWith(supabase, orderId, "confirmed", {});
  if (confirmed.status === "error" || !crewId) return confirmed;
  return assignWith(supabase, orderId, crewId);
}

export async function assignCrew(input: AssignCrewInput): Promise<AdminOrderResult> {
  const parsed = assignCrewSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "failed" };
  return assignWith(await admin(parsed.data.orderId), parsed.data.orderId, parsed.data.crewId);
}

export async function cancelOrderAsAdmin(input: AdminCancelInput): Promise<AdminOrderResult> {
  const parsed = adminCancelSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "reason_required" };
  return transition(parsed.data.orderId, "cancelled", { reason: parsed.data.reason });
}

export async function markNoShow(input: AdminNoShowInput): Promise<AdminOrderResult> {
  const parsed = adminNoShowSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "reason_required" };
  return transition(parsed.data.orderId, "no_show", { reason: parsed.data.reason });
}

export async function postponeOrderAsAdmin(input: AdminPostponeInput): Promise<AdminOrderResult> {
  const parsed = adminPostponeSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "failed" };
  return transition(
    parsed.data.orderId,
    "postponed",
    parsed.data.reason ? { reason: parsed.data.reason } : {},
  );
}

export async function rescheduleOrderAsAdmin(
  input: AdminRescheduleInput,
): Promise<AdminOrderResult> {
  const parsed = adminRescheduleSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "failed" };
  return transition(parsed.data.orderId, "pending_confirmation", {
    service_date: parsed.data.serviceDate,
    slot_id: parsed.data.slotId,
  });
}

export async function overrideStatus(input: OverrideInput): Promise<AdminOrderResult> {
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "reason_required" };
  return transition(parsed.data.orderId, parsed.data.toStatus, {
    override: true,
    reason: parsed.data.reason,
  });
}

/**
 * "Verify subscription" (A2): drops the order's coverage (it becomes a cash
 * order) or puts its address's subscription on it. The database checks the
 * order's status and the subscription (ZL034, ZL038) and audits it.
 */
export async function setOrderSubscription(
  input: SetOrderSubscriptionInput,
): Promise<AdminEditResult> {
  const parsed = setOrderSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await admin(parsed.data.orderId);
  const { error } = await supabase.rpc("admin_set_order_subscription", {
    p_order_id: parsed.data.orderId,
    p_use: parsed.data.use,
  });
  return error
    ? editFailure("admin_set_order_subscription", error, (message) =>
        Sentry.captureMessage(message, "error"),
      )
    : { status: "done" };
}
