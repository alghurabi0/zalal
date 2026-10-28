"use server";

import * as Sentry from "@sentry/nextjs";

import { type AdminEditResult, editFailure } from "@/lib/admin/edit-errors";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import {
  type ActivateSubscriptionInput,
  activateSubscriptionSchema,
  type AddSubscriptionNoteInput,
  addSubscriptionNoteSchema,
  type AdjustSubscriptionVisitsInput,
  adjustSubscriptionVisitsSchema,
  type EndSubscriptionInput,
  endSubscriptionSchema,
  type SetSubscriptionPaidInput,
  setSubscriptionPaidSchema,
} from "@/lib/schemas/subscription";
import { createClient } from "@/lib/supabase/server";

// A7's actions (spec §8.2), as the admin: the admin_*_subscription RPCs,
// which check the role, the subscription's status and the visits, and write
// the audit log.

const report = (message: string) => Sentry.captureMessage(message, "error");

export async function activateSubscription(
  input: ActivateSubscriptionInput,
): Promise<AdminEditResult> {
  const parsed = activateSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const { subscriptionId, startsOn, visits, tanks, priceIqd, paid, note } = parsed.data;
  await requireViewer(routes.adminSubscription(subscriptionId), "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_activate_subscription", {
    p_subscription_id: subscriptionId,
    p_starts_on: startsOn,
    p_visits: visits,
    p_tanks: tanks,
    p_price_iqd: priceIqd,
    p_paid: paid,
    p_note: note === "" ? undefined : note,
  });
  return error ? editFailure("admin_activate_subscription", error, report) : { status: "done" };
}

export async function setSubscriptionPaid(
  input: SetSubscriptionPaidInput,
): Promise<AdminEditResult> {
  const parsed = setSubscriptionPaidSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  await requireViewer(routes.adminSubscription(parsed.data.subscriptionId), "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_subscription_paid", {
    p_subscription_id: parsed.data.subscriptionId,
    p_paid: parsed.data.paid,
  });
  return error ? editFailure("admin_set_subscription_paid", error, report) : { status: "done" };
}

export async function adjustSubscriptionVisits(
  input: AdjustSubscriptionVisitsInput,
): Promise<AdminEditResult> {
  const parsed = adjustSubscriptionVisitsSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  await requireViewer(routes.adminSubscription(parsed.data.subscriptionId), "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_adjust_subscription_visits", {
    p_subscription_id: parsed.data.subscriptionId,
    p_delta: parsed.data.delta,
    p_reason: parsed.data.reason,
  });
  return error
    ? editFailure("admin_adjust_subscription_visits", error, report)
    : { status: "done" };
}

export async function endSubscription(input: EndSubscriptionInput): Promise<AdminEditResult> {
  const parsed = endSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  await requireViewer(routes.adminSubscription(parsed.data.subscriptionId), "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_end_subscription", {
    p_subscription_id: parsed.data.subscriptionId,
    p_reason: parsed.data.reason,
  });
  return error ? editFailure("admin_end_subscription", error, report) : { status: "done" };
}

export async function addSubscriptionNote(
  input: AddSubscriptionNoteInput,
): Promise<AdminEditResult> {
  const parsed = addSubscriptionNoteSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  await requireViewer(routes.adminSubscription(parsed.data.subscriptionId), "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_add_subscription_note", {
    p_subscription_id: parsed.data.subscriptionId,
    p_note: parsed.data.note,
  });
  return error ? editFailure("admin_add_subscription_note", error, report) : { status: "done" };
}
