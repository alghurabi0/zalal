import { z } from "zod";

import { MAX_VIDEO_SECONDS } from "@/lib/booking/media";
import { chatObjectPathPattern } from "@/lib/chat/media";
import { CHAT_TOPICS } from "@/lib/chat/messages";

// A chat message as Chat (spec §5.16) and the admin inbox (A4) send it to
// send_chat_message(). The database checks everything again.

export const CHAT_BODY_MAX = 2000;

export const sendChatMessageSchema = z
  .object({
    clientId: z.uuid(),
    /** Admins name the thread; a customer writes to their own. */
    threadId: z.uuid().optional(),
    body: z.string().trim().max(CHAT_BODY_MAX).optional(),
    mediaPath: z.string().regex(chatObjectPathPattern).optional(),
    durationS: z.number().min(0).max(MAX_VIDEO_SECONDS).optional(),
    orderId: z.uuid().optional(),
    topic: z.enum(CHAT_TOPICS).optional(),
  })
  .refine((message) => Boolean(message.body || message.mediaPath || message.topic), {
    message: "empty_message",
  })
  .refine(
    (message) => !(message.topic === "reschedule" || message.topic === "cancel") || message.orderId,
    {
      message: "order_required",
    },
  );

export type SendChatMessageInput = z.input<typeof sendChatMessageSchema>;
