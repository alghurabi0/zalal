import { z } from "zod";

// The inbox's query string (A4): `?q=` searches by name or phone, `&n=`
// shows more threads.

export const INBOX_PAGE = 30;
export const INBOX_MAX = 100;

export const inboxQuerySchema = z.object({
  q: z.string().trim().max(60).optional().catch(undefined),
  n: z.coerce.number().int().min(INBOX_PAGE).max(INBOX_MAX).catch(INBOX_PAGE),
});

export type InboxQuery = z.infer<typeof inboxQuerySchema>;

/** A path with the inbox's query kept (search and page size). */
export function withInboxQuery(path: string, query: InboxQuery, n = query.n): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (n > INBOX_PAGE) params.set("n", String(n));
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}
