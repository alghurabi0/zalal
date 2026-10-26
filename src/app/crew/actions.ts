"use server";

import * as Sentry from "@sentry/nextjs";

import { requireViewer } from "@/lib/auth/viewer";
import {
  type CrewJobError,
  crewJobErrorFor,
  FINISH_FIELD_ERRORS,
  type JobMediaError,
  jobMediaErrorFor,
} from "@/lib/crew/errors";
import type { Json } from "@/lib/database.types";
import type { OrderStatus } from "@/lib/orders/status";
import { routes } from "@/lib/routes";
import {
  type AdvanceJobInput,
  advanceJobSchema,
  type AttachJobMediaInput,
  attachJobMediaSchema,
  type CrewNoShowInput,
  crewNoShowSchema,
  type FinishJobInput,
  finishJobSchema,
  type RemoveJobMediaInput,
  removeJobMediaSchema,
} from "@/lib/schemas/crew-job";
import { createClient } from "@/lib/supabase/server";

// C3a, C3b and C4 (spec §6, §8.1), as the crew: every status change goes
// through transition_order(), and every photo or clip through
// attach_job_media() / remove_job_media(), which check that the job is this
// crew's and that the change is allowed.

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

/** خلصنا (C4): the cash tick, sterilant, residual chlorine and an internal note. */
export async function finishJob(input: FinishJobInput): Promise<CrewJobResult> {
  const parsed = finishJobSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    const field = FINISH_FIELD_ERRORS.find((key) => key === message);
    return { status: "error", error: field ?? "failed" };
  }
  const { orderId, sterilant, residualChlorine, note } = parsed.data;
  return transition(orderId, "completed", {
    cash_collected: true,
    sterilant,
    residual_chlorine_mg_l: residualChlorine,
    note,
  });
}

/** الزبون مو موجود: the note is internal (order_event_notes). */
export async function markNoShow(input: CrewNoShowInput): Promise<CrewJobResult> {
  const parsed = crewNoShowSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "reason_required" };
  return transition(parsed.data.orderId, "no_show", { reason: parsed.data.note });
}

export type JobMediaResult =
  { status: "done"; id: string } | { status: "error"; error: JobMediaError };

/**
 * C3b: records a finished upload as the job's before or after photo or clip.
 * Safe to repeat: a retry after a lost answer gets the same row.
 */
export async function attachJobMedia(input: AttachJobMediaInput): Promise<JobMediaResult> {
  const parsed = attachJobMediaSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "upload_not_found" };
  const { orderId, kind, path, durationS } = parsed.data;
  await requireViewer(routes.crewJob(orderId), "crew");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attach_job_media", {
    p_order_id: orderId,
    p_kind: kind,
    p_path: path,
    p_duration_s: durationS ?? undefined,
  });
  if (!error) return { status: "done", id: data };
  const code = jobMediaErrorFor(error);
  if (code === "failed") Sentry.captureMessage(`attach_job_media failed (${error.code})`, "error");
  return { status: "error", error: code };
}

/** C3b: takes back a wrong photo or clip while the job is open, then deletes the file. */
export async function removeJobMedia(
  input: RemoveJobMediaInput,
): Promise<{ status: "done" } | { status: "error"; error: JobMediaError }> {
  const parsed = removeJobMediaSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "not_found" };
  await requireViewer(routes.crewJob(parsed.data.orderId), "crew");
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("remove_job_media", {
    p_media_id: parsed.data.mediaId,
  });
  if (error) {
    const code = jobMediaErrorFor(error);
    if (code === "failed")
      Sentry.captureMessage(`remove_job_media failed (${error.code})`, "error");
    return { status: "error", error: code };
  }
  // Best effort: the row is gone, so the file is only clutter if this fails.
  await supabase.storage.from("order-media").remove([path]);
  return { status: "done" };
}
