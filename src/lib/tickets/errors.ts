// create_ticket()'s error codes (supabase/CLAUDE.md) as the Issue report
// shows them.

export type IssueError =
  /** ZL029: 5 reports an hour. */
  | "too_many"
  /** ZL009: a file is gone, too old or already attached; add it again. */
  | "upload_missing"
  /** ZL028 or P0002: the order can't be named any more; pick another. */
  | "order_unavailable"
  | "failed";

const byCode: Record<string, IssueError> = {
  ZL029: "too_many",
  ZL009: "upload_missing",
  ZL028: "order_unavailable",
  P0002: "order_unavailable",
};

export function issueErrorFor(code: string | undefined): IssueError {
  return (code && byCode[code]) || "failed";
}

export type CreateTicketResult =
  { status: "created"; ticketId: string; number: number } | { status: "error"; error: IssueError };
