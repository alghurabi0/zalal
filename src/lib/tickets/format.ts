import type { Database } from "@/lib/database.types";

// Ticket labels and rules shared by the Issue report (spec §5.17), My
// reports (N11) and A5. Safe for the browser.

export type TicketCategory = Database["public"]["Enums"]["ticket_category"];
export type TicketStatus = Database["public"]["Enums"]["ticket_status"];
export type TicketSource = Database["public"]["Enums"]["ticket_source"];

/** Issue.dc.html's tiles, in its order (two columns, start side first). */
export const TICKET_CATEGORIES = [
  "leak",
  "smell",
  "late",
  "staff",
  "payment",
  "other",
] as const satisfies readonly TicketCategory[];

/** open → in progress → closed; admins may also reopen (A5). */
export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "closed",
] as const satisfies readonly TicketStatus[];

/** create_ticket() takes orders whose slot is at most this many days ago. */
export const ISSUE_ORDER_DAYS = 90;

export const TICKET_DESCRIPTION_MIN = 10;
export const TICKET_DESCRIPTION_MAX = 1000;
export const TICKET_NOTE_MAX = 1000;

/** The status chip's tone: open is amber, in progress blue, closed grey. */
export function ticketStatusTone(status: TicketStatus): "warn" | "info" | "neutral" {
  if (status === "open") return "warn";
  if (status === "in_progress") return "info";
  return "neutral";
}
