import "server-only";

import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

// The chat inbox's reads (spec §8.2 A4), as the admin: RLS lets admins read
// every thread, message, profile, order, address and ticket. Pages call
// requireViewer(…, "admin") first.

type Enums = Database["public"]["Enums"];

export type InboxRow = Database["public"]["Functions"]["admin_chat_inbox"]["Returns"][number];

/** Threads with messages, unread first, then newest (admin_chat_inbox). */
export async function chatInbox(search: string | undefined, limit: number): Promise<InboxRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_chat_inbox", {
    p_search: search,
    p_limit: limit,
  });
  if (error) throw new Error(`Chat inbox failed: ${error.message}`);
  return data;
}

/** The threads with customer messages no admin has read (nav badge, A1). */
export async function unreadThreadIds(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_threads")
    .select("id")
    .gt("admin_unread", 0)
    .limit(1000);
  if (error) throw new Error(`Unread threads failed: ${error.message}`);
  return data.map((thread) => thread.id);
}

export type AdminThread = {
  id: string;
  userId: string;
  fullName: string | null;
  phone: string;
};

export async function adminThread(id: string): Promise<AdminThread | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_threads")
    .select("id, user_id, profiles(full_name, phone)")
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<
      { id: string; user_id: string; profiles: { full_name: string | null; phone: string } },
      { merge: false }
    >();
  if (error) throw new Error(`Chat thread failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    userId: data.user_id,
    fullName: data.profiles.full_name,
    phone: data.profiles.phone,
  };
}

export type PanelOrder = {
  id: string;
  number: number;
  status: Enums["order_status"];
  slot_start_at: string;
};
export type PanelAddress = {
  id: string;
  label: Enums["address_label"];
  district: string;
  landmark: string;
};
export type PanelTicket = {
  id: string;
  number: number;
  status: Enums["ticket_status"];
  source: Enums["ticket_source"];
  order: { id: string; number: number } | null;
};

export const PANEL_ROWS = 10;

/** A4's side panel: the customer's latest orders, addresses and tickets. */
export async function customerPanel(userId: string): Promise<{
  orders: PanelOrder[];
  addresses: PanelAddress[];
  tickets: PanelTicket[];
}> {
  const supabase = await createClient();
  const [orders, addresses, tickets] = await Promise.all([
    supabase
      .from("orders")
      .select("id, number, status, slot_start_at")
      .eq("customer_id", userId)
      .order("created_at", { ascending: false })
      .limit(PANEL_ROWS),
    supabase
      .from("addresses")
      .select("id, label, district, landmark")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at"),
    supabase
      .from("tickets")
      .select("id, number, status, source, orders(id, number)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(PANEL_ROWS)
      .overrideTypes<
        {
          id: string;
          number: number;
          status: Enums["ticket_status"];
          source: Enums["ticket_source"];
          orders: { id: string; number: number } | null;
        }[],
        { merge: false }
      >(),
  ]);
  for (const result of [orders, addresses, tickets]) {
    if (result.error) throw new Error(`Customer panel failed: ${result.error.message}`);
  }
  return {
    orders: orders.data ?? [],
    addresses: addresses.data ?? [],
    tickets: (tickets.data ?? []).map(({ orders: order, ...ticket }) => ({ ...ticket, order })),
  };
}
