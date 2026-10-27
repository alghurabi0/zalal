import { z } from "zod";

import { MAX_VIDEO_SECONDS } from "@/lib/booking/media";
import {
  TICKET_CATEGORIES,
  TICKET_DESCRIPTION_MAX,
  TICKET_DESCRIPTION_MIN,
  TICKET_NOTE_MAX,
  TICKET_STATUSES,
} from "@/lib/tickets/format";
import { MAX_TICKET_FILES, ticketObjectPathPattern } from "@/lib/tickets/media";

// The Issue report (spec §5.17) as create_ticket() takes it, and A5's admin
// actions. The database checks everything again.

export const createTicketSchema = z.object({
  /** Makes a retried submit return the first ticket. */
  clientId: z.uuid(),
  category: z.enum(TICKET_CATEGORIES),
  description: z
    .string()
    .trim()
    .min(TICKET_DESCRIPTION_MIN, "too_short")
    .max(TICKET_DESCRIPTION_MAX, "too_long"),
  orderId: z.uuid().optional(),
  media: z
    .array(
      z.object({
        path: z.string().regex(ticketObjectPathPattern),
        /** Videos only, read on the device. */
        durationS: z.number().min(0).max(MAX_VIDEO_SECONDS).optional(),
      }),
    )
    .max(MAX_TICKET_FILES),
});

export type CreateTicketInput = z.input<typeof createTicketSchema>;

export const setTicketStatusSchema = z.object({
  ticketId: z.uuid(),
  status: z.enum(TICKET_STATUSES),
});

export type SetTicketStatusInput = z.input<typeof setTicketStatusSchema>;

export const addTicketNoteSchema = z.object({
  ticketId: z.uuid(),
  note: z.string().trim().min(1, "empty").max(TICKET_NOTE_MAX, "too_long"),
});

export type AddTicketNoteInput = z.input<typeof addTicketNoteSchema>;
