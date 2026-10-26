import type { ChatRow } from "./messages";

// send_chat_message()'s error codes (supabase/CLAUDE.md) as Chat and the
// inbox show them.

export type ChatSendError =
  /** ZL027: 20 messages a minute. */
  | "too_many"
  /** ZL009: the file is gone, too old or already sent; pick it again. */
  | "upload_missing"
  | "failed";

const byCode: Record<string, ChatSendError> = {
  ZL027: "too_many",
  ZL009: "upload_missing",
};

export function chatSendErrorFor(code: string | undefined): ChatSendError {
  return (code && byCode[code]) || "failed";
}

/** What sending a message returns to the screen. */
export type SendResult =
  | { status: "sent"; message: ChatRow }
  | { status: "error"; error: ChatSendError };
