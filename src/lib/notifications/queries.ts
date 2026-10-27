import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { NotificationInput } from "./describe";

// The customer's notifications (spec §5.7), as the logged-in user: RLS keeps
// them to their own rows of their current role (migration notifications).

export const PAGE_SIZE = 30;
/** The most "عرض المزيد" can reach, so a URL can't ask for everything. */
export const MAX_SHOWN = 300;

export type ListedNotification = NotificationInput & {
  id: string;
  readAt: string | null;
  createdAt: string;
};

/** The newest `limit` notifications, and whether there are more. */
export async function listNotifications(
  limit: number,
): Promise<{ items: ListedNotification[]; more: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, data, order_id, ticket_id, read_at, created_at")
    .order("created_at", { ascending: false })
    .order("id")
    .limit(limit + 1);
  if (error) throw new Error(`Notifications read failed: ${error.message}`);
  const items = data.slice(0, limit).map((row) => ({
    id: row.id,
    type: row.type,
    data: row.data,
    orderId: row.order_id,
    ticketId: row.ticket_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
  return { items, more: data.length > limit };
}

/** Whether any notification is unread (the Home bell's dot). */
export async function hasUnreadNotifications(): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw new Error(`Unread notifications read failed: ${error.message}`);
  return (count ?? 0) > 0;
}
