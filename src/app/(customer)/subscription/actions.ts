"use server";

import * as Sentry from "@sentry/nextjs";

import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import {
  type RequestSubscriptionInput,
  requestSubscriptionSchema,
} from "@/lib/schemas/subscription";
import { createClient } from "@/lib/supabase/server";
import {
  type RequestSubscriptionError,
  requestSubscriptionErrorFor,
} from "@/lib/subscriptions/errors";

export type RequestSubscriptionResult =
  | { status: "requested" }
  | { status: "error"; error: RequestSubscriptionError };

/**
 * N8's "اطلب الاشتراك" (spec N8, §9.2): request_subscription() as the
 * customer, for one of their addresses. The database checks the address,
 * the service area, the plan and any subscription already there, and tells
 * the admins; asking again returns the same request.
 */
export async function requestSubscription(
  input: RequestSubscriptionInput,
): Promise<RequestSubscriptionResult> {
  const parsed = requestSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "failed" };
  await requireViewer(routes.subscriptionFor(parsed.data.addressId));
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_subscription", {
    p_address_id: parsed.data.addressId,
  });
  if (error) {
    const code = requestSubscriptionErrorFor(error.code);
    // Only the SQLSTATE: the message can quote the input.
    if (code === "failed") Sentry.captureMessage(`request_subscription failed (${error.code})`, "error");
    return { status: "error", error: code };
  }
  return { status: "requested" };
}
