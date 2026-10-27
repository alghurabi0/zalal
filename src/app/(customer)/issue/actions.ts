"use server";

import * as Sentry from "@sentry/nextjs";

import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import { type CreateTicketInput, createTicketSchema } from "@/lib/schemas/ticket";
import { createClient } from "@/lib/supabase/server";
import { type CreateTicketResult, issueErrorFor } from "@/lib/tickets/errors";

// The Issue report (spec §5.17) through create_ticket(), which checks the
// order, the files and the hourly limit, and posts the chat message.

export async function createTicket(input: CreateTicketInput): Promise<CreateTicketResult> {
  const parsed = createTicketSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "failed" };
  const { clientId, category, description, orderId, media } = parsed.data;
  await requireViewer(routes.issue);

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_ticket", {
      p_client_id: clientId,
      p_category: category,
      p_description: description,
      p_order_id: orderId,
      p_media: media.map((file) => ({ path: file.path, duration_s: file.durationS ?? null })),
    })
    .single();
  if (error) {
    const issue = issueErrorFor(error.code);
    // Only the SQLSTATE: the message can quote the description.
    if (issue === "failed") Sentry.captureMessage(`create_ticket failed (${error.code})`, "error");
    return { status: "error", error: issue };
  }
  return { status: "created", ticketId: data.ticket_id, number: data.ticket_number };
}
