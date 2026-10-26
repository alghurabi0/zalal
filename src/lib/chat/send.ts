import "server-only";

import * as Sentry from "@sentry/nextjs";
import type { z } from "zod";

import type { SendResult } from "@/lib/chat/errors";
import type { sendChatMessageSchema } from "@/lib/schemas/chat";
import { createClient } from "@/lib/supabase/server";

import { chatSendErrorFor } from "./errors";

/**
 * send_chat_message() as the logged-in user, after the action has checked
 * the input and the viewer. The customer's Chat and A4 share it.
 */
export async function sendAsViewer(
  message: z.output<typeof sendChatMessageSchema>,
): Promise<SendResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("send_chat_message", {
      p_client_id: message.clientId,
      p_thread_id: message.threadId,
      p_body: message.body || undefined,
      p_media_path: message.mediaPath,
      p_duration_s: message.durationS,
      p_order_id: message.orderId,
      p_topic: message.topic,
    })
    .single();
  if (error) {
    const code = chatSendErrorFor(error.code);
    // Only the SQLSTATE: the message can quote the input.
    if (code === "failed")
      Sentry.captureMessage(`send_chat_message failed (${error.code})`, "error");
    return { status: "error", error: code };
  }
  return { status: "sent", message: data };
}

/** mark_chat_read() as the logged-in user. */
export async function markReadAsViewer(threadId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_chat_read", { p_thread_id: threadId });
  if (error) Sentry.captureMessage(`mark_chat_read failed (${error.code})`, "error");
}
