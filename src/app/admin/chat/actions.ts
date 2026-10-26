"use server";

import { z } from "zod";

import { requireViewer } from "@/lib/auth/viewer";
import type { SendResult } from "@/lib/chat/errors";
import { markReadAsViewer, sendAsViewer } from "@/lib/chat/send";
import { routes } from "@/lib/routes";
import { type SendChatMessageInput, sendChatMessageSchema } from "@/lib/schemas/chat";

// The inbox (A4) as the admin, through send_chat_message() and
// mark_chat_read(). Admins name the thread; they don't send topics.

export async function sendAdminChatMessage(input: SendChatMessageInput): Promise<SendResult> {
  const parsed = sendChatMessageSchema.safeParse(input);
  if (!parsed.success || !parsed.data.threadId || parsed.data.topic) {
    return { status: "error", error: "failed" };
  }
  await requireViewer(routes.adminChatThread(parsed.data.threadId), "admin");
  return sendAsViewer(parsed.data);
}

export async function markAdminChatRead(threadId: string): Promise<void> {
  const parsed = z.uuid().safeParse(threadId);
  if (!parsed.success) return;
  await requireViewer(routes.adminChatThread(parsed.data), "admin");
  await markReadAsViewer(parsed.data);
}
