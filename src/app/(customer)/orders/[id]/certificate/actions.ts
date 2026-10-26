"use server";

import * as Sentry from "@sentry/nextjs";

import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import { type RateOrderInput, rateOrderSchema } from "@/lib/schemas/rating";
import { createClient } from "@/lib/supabase/server";

// Report's rating (spec §5.15) through rate_order(), which checks that the
// order is the customer's, completed and not rated yet, and opens a ticket
// at 3 stars or fewer.

export type RateOrderError = "already_rated" | "not_allowed" | "failed";
export type RateOrderResult =
  { status: "done"; ticketNumber: number | null } | { status: "error"; error: RateOrderError };

export async function rateOrder(input: RateOrderInput): Promise<RateOrderResult> {
  const parsed = rateOrderSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "failed" };
  const { orderId, stars, tags, comment } = parsed.data;
  await requireViewer(routes.certificate(orderId));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rate_order", {
    p_order_id: orderId,
    p_stars: stars,
    p_tags: tags,
    // Generated types say string; the RPC takes null for no comment.
    p_comment: comment ?? undefined,
  });
  if (error) {
    if (error.code === "ZL026") return { status: "error", error: "already_rated" };
    if (error.code === "ZL025" || error.code === "P0002" || error.code === "42501") {
      return { status: "error", error: "not_allowed" };
    }
    // Only the SQLSTATE: the message can quote the comment.
    Sentry.captureMessage(`rate_order failed (${error.code})`, "error");
    return { status: "error", error: "failed" };
  }
  return { status: "done", ticketNumber: data };
}
