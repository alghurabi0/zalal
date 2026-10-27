"use server";

import * as Sentry from "@sentry/nextjs";

import { type AdminEditResult, editFailure } from "@/lib/admin/edit-errors";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import {
  type AddTicketNoteInput,
  addTicketNoteSchema,
  type SetTicketStatusInput,
  setTicketStatusSchema,
} from "@/lib/schemas/ticket";
import { createClient } from "@/lib/supabase/server";

// A5's actions (spec §8.2), as the admin: admin_set_ticket_status() and
// admin_add_ticket_note(), which check the role and write the audit log.

const report = (message: string) => Sentry.captureMessage(message, "error");

export async function setTicketStatus(input: SetTicketStatusInput): Promise<AdminEditResult> {
  const parsed = setTicketStatusSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  await requireViewer(routes.adminTicket(parsed.data.ticketId), "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_ticket_status", {
    p_ticket_id: parsed.data.ticketId,
    p_status: parsed.data.status,
  });
  return error ? editFailure("admin_set_ticket_status", error, report) : { status: "done" };
}

export async function addTicketNote(input: AddTicketNoteInput): Promise<AdminEditResult> {
  const parsed = addTicketNoteSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  await requireViewer(routes.adminTicket(parsed.data.ticketId), "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_add_ticket_note", {
    p_ticket_id: parsed.data.ticketId,
    p_note: parsed.data.note,
  });
  return error ? editFailure("admin_add_ticket_note", error, report) : { status: "done" };
}
