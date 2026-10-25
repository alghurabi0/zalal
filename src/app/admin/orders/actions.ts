"use server";

import * as Sentry from "@sentry/nextjs";
import type { z } from "zod";

import { type AdminOrderError, adminOrderErrorFor } from "@/lib/admin/errors";
import { requireViewer } from "@/lib/auth/viewer";
import type { Json } from "@/lib/database.types";
import { routes } from "@/lib/routes";
import {
  type AdminCancelInput,
  adminCancelSchema,
  type AdminNoShowInput,
  adminNoShowSchema,
  type AdminRescheduleInput,
  adminRescheduleSchema,
  type AssignCrewInput,
  assignCrewSchema,
  type ConfirmOrderInput,
  confirmOrderSchema,
  type OverrideInput,
  overrideSchema,
} from "@/lib/schemas/admin-order";
import { createClient } from "@/lib/supabase/server";

// The A2 drawer's actions (spec §6, §8.2), as the admin: transition_order()
// for status changes and assign_crew() for the crew. Both check the role,
// write the audit log and keep staff reasons internal.

export type AdminOrderResult = { status: "done" } | { status: "error"; error: AdminOrderError };

type OrderStatus = z.infer<typeof overrideSchema>["toStatus"];

function failure(rpc: string, error: { code?: string; message?: string }): AdminOrderResult {
  const code = adminOrderErrorFor(error);
  // Only the SQLSTATE: the message can quote the input.
  if (code === "failed") Sentry.captureMessage(`${rpc} failed (${error.code})`, "error");
  return { status: "error", error: code };
}

async function admin(orderId: string) {
  await requireViewer(routes.adminOrder(orderId), "admin");
  return createClient();
}

async function transition(
  orderId: string,
  toStatus: OrderStatus,
  payload: { [key: string]: Json },
): Promise<AdminOrderResult> {
  const supabase = await admin(orderId);
  const { error } = await supabase.rpc("transition_order", {
    p_order_id: orderId,
    p_to_status: toStatus,
    p_payload: payload,
  });
  return error ? failure("transition_order", error) : { status: "done" };
}

/** Confirms, assigning the chosen crew first when one is picked. */
export async function confirmOrder(input: ConfirmOrderInput): Promise<AdminOrderResult> {
  const parsed = confirmOrderSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "failed" };
  const { orderId, crewId } = parsed.data;
  if (crewId) {
    const assigned = await assignCrew({ orderId, crewId });
    if (assigned.status === "error") return assigned;
  }
  return transition(orderId, "confirmed", {});
}

export async function assignCrew(input: AssignCrewInput): Promise<AdminOrderResult> {
  const parsed = assignCrewSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "failed" };
  const supabase = await admin(parsed.data.orderId);
  const { error } = await supabase.rpc("assign_crew", {
    p_order_id: parsed.data.orderId,
    // The generated type says string; the function takes null to remove the crew.
    p_crew_id: parsed.data.crewId as string,
  });
  return error ? failure("assign_crew", error) : { status: "done" };
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
