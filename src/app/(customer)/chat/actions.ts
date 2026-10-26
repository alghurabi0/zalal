"use server";

import { z } from "zod";

import type { SendResult } from "@/lib/chat/errors";
import { requireViewer } from "@/lib/auth/viewer";
import { markReadAsViewer, sendAsViewer } from "@/lib/chat/send";
import { routes } from "@/lib/routes";
import { type SendChatMessageInput, sendChatMessageSchema } from "@/lib/schemas/chat";

// Chat (spec §5.16) as the customer, through send_chat_message() and
// mark_chat_read(). The database checks the thread, the order tag, the file
// and the limits.

export async function sendChatMessage(input: SendChatMessageInput): Promise<SendResult> {
  const parsed = sendChatMessageSchema.safeParse(input);
  // A customer writes only to their own thread, which the database finds.
  if (!parsed.success || parsed.data.threadId) return { status: "error", error: "failed" };
  await requireViewer(routes.chat);
  return sendAsViewer(parsed.data);
}

export async function markChatRead(threadId: string): Promise<void> {
  const parsed = z.uuid().safeParse(threadId);
  if (!parsed.success) return;
  await requireViewer(routes.chat);
  await markReadAsViewer(parsed.data);
}
