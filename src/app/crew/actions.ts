"use server";

import * as Sentry from "@sentry/nextjs";

import { requireViewer } from "@/lib/auth/viewer";
import { type CrewJobError, crewJobErrorFor } from "@/lib/crew/errors";
import type { Json } from "@/lib/database.types";
import type { OrderStatus } from "@/lib/orders/status";
import { routes } from "@/lib/routes";
import {
  type AdvanceJobInput,
  advanceJobSchema,
  type CrewNoShowInput,
  crewNoShowSchema,
  type FinishJobInput,
  finishJobSchema,
} from "@/lib/schemas/crew-job";
import { createClient } from "@/lib/supabase/server";

// C3a and C4 (spec §6, §8.1), as the crew: every status change goes through
// transition_order(), which checks that the job is this crew's and that the
// move is allowed.

export type CrewJobResult = { status: "done" } | { status: "error"; error: CrewJobError };

async function transition(
  orderId: string,
  toStatus: OrderStatus,
  payload: { [key: string]: Json },
): Promise<CrewJobResult> {
  await requireViewer(routes.crewJob(orderId), "crew");
  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_order", {
    p_order_id: orderId,
    p_to_status: toStatus,
    p_payload: payload,
  });
  if (!error) return { status: "done" };
  const code = crewJobErrorFor(error);
  // Only the SQLSTATE: the message can quote the input.
  if (code === "failed") Sentry.captureMessage(`transition_order failed (${error.code})`, "error");
  return { status: "error", error: code };
}

/** طلعنا, وصلنا, بدينا الشغل. */
export async function advanceJob(input: AdvanceJobInput): Promise<CrewJobResult> {
  const parsed = advanceJobSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "failed" };
  return transition(parsed.data.orderId, parsed.data.toStatus, {});
}

/** خلصنا (C4): the cash tick for now; part B adds the rest of the form. */
export async function finishJob(input: FinishJobInput): Promise<CrewJobResult> {
  const parsed = finishJobSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "cash_not_collected" };
  return transition(parsed.data.orderId, "completed", { cash_collected: true });
}

/** الزبون مو موجود: the note is internal (order_event_notes). */
export async function markNoShow(input: CrewNoShowInput): Promise<CrewJobResult> {
  const parsed = crewNoShowSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "reason_required" };
  return transition(parsed.data.orderId, "no_show", { reason: parsed.data.note });
}
