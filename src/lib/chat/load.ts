import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

import { CHAT_MEDIA_BUCKET } from "./media";
import { CHAT_PAGE, type ChatMessage, type ChatRow, fromRow } from "./messages";

// Reading a thread's messages as the logged-in user (RLS: the customer's own
// thread, or any thread for admins), on the server for the first page and
// in the browser for older ones. Files get signed links for an hour.

type Client = SupabaseClient<Database>;

/**
 * A page of the thread's messages, oldest first: the newest CHAT_PAGE, or
 * the CHAT_PAGE before `before` (a created_at). `hasOlder` says whether more
 * came before them.
 */
export async function fetchMessages(
  client: Client,
  threadId: string,
  before?: string,
): Promise<{ messages: ChatMessage[]; hasOlder: boolean }> {
  let query = client
    .from("chat_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(CHAT_PAGE + 1);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw new Error(`Chat messages failed: ${error.message}`);
  const page = data.slice(0, CHAT_PAGE).reverse();
  return { messages: await withLinks(client, page), hasOlder: data.length > CHAT_PAGE };
}

/** The rows as messages, with a signed link for each file. */
export async function withLinks(client: Client, rows: ChatRow[]): Promise<ChatMessage[]> {
  const paths = rows.flatMap((row) => (row.media_path ? [row.media_path] : []));
  const links = new Map<string, string>();
  if (paths.length > 0) {
    const { data } = await client.storage.from(CHAT_MEDIA_BUCKET).createSignedUrls(paths, 60 * 60);
    for (const link of data ?? []) {
      if (link.path && link.signedUrl) links.set(link.path, link.signedUrl);
    }
  }
  return rows.map((row) =>
    fromRow(row, row.media_path ? (links.get(row.media_path) ?? null) : null),
  );
}
