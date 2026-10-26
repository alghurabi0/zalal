"use server";

import * as Sentry from "@sentry/nextjs";

import { type AdminEditResult, editFailure } from "@/lib/admin/edit-errors";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import {
  type BlockDateInput,
  blockDateSchema,
  type CreateSlotInput,
  createSlotSchema,
  type UnblockDateInput,
  unblockDateSchema,
  type UpdateSlotInput,
  updateSlotSchema,
} from "@/lib/schemas/admin-catalog";
import { createClient } from "@/lib/supabase/server";

// A9's actions (spec §8.2). None of them touch orders: the orders a change
// leaves out of the schedule show up in admin_schedule_conflicts().

const report = (message: string) => Sentry.captureMessage(message, "error");

async function admin() {
  await requireViewer(routes.adminSchedule, "admin");
  return createClient();
}

export async function createSlot(input: CreateSlotInput): Promise<AdminEditResult> {
  const parsed = createSlotSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await admin();
  const { error } = await supabase.rpc("admin_create_slot", {
    p_start_time: parsed.data.start,
    p_end_time: parsed.data.end,
    p_capacity: parsed.data.capacity,
    p_weekdays: parsed.data.weekdays,
  });
  return error ? editFailure("admin_create_slot", error, report) : { status: "done" };
}

export async function updateSlot(input: UpdateSlotInput): Promise<AdminEditResult> {
  const parsed = updateSlotSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await admin();
  const { error } = await supabase.rpc("admin_update_slot", {
    p_slot_id: parsed.data.id,
    p_capacity: parsed.data.capacity,
    p_weekdays: parsed.data.weekdays,
    p_active: parsed.data.active,
  });
  return error ? editFailure("admin_update_slot", error, report) : { status: "done" };
}

export async function blockDate(input: BlockDateInput): Promise<AdminEditResult> {
  const parsed = blockDateSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await admin();
  const { error } = await supabase.rpc("admin_block_date", {
    p_date: parsed.data.date,
    // The generated type says string; the function takes null for no reason.
    p_reason: parsed.data.reason as string,
  });
  return error ? editFailure("admin_block_date", error, report) : { status: "done" };
}

export async function unblockDate(input: UnblockDateInput): Promise<AdminEditResult> {
  const parsed = unblockDateSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await admin();
  const { error } = await supabase.rpc("admin_unblock_date", { p_date: parsed.data.date });
  return error ? editFailure("admin_unblock_date", error, report) : { status: "done" };
}
