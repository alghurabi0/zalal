import "server-only";

import { addDays, baghdadToday } from "@/lib/dates";
import type { OrderStatus } from "@/lib/orders/status";
import { createClient } from "@/lib/supabase/server";
import { OVERVIEW_COLUMNS, type Subscription, toSubscription } from "@/lib/subscriptions/state";

import type { AdminSubscriptionsQuery } from "./subscriptions-query";
import { customersMatching } from "./ticket-queries";

// A7 reads, as the admin: RLS lets admins read every subscription, its notes
// and orders, and every profile. Pages call requireViewer(…, "admin") first.

/** A7's list for a view: `n` rows, with whether there are more. */
export async function listAdminSubscriptions(
  query: AdminSubscriptionsQuery,
  now: Date = new Date(),
): Promise<{ subscriptions: Subscription[]; more: boolean }> {
  const supabase = await createClient();
  let request = supabase
    .from("subscription_overview")
    .select(OVERVIEW_COLUMNS)
    .limit(query.n + 1);
  switch (query.view) {
    case "requests":
      request = request.eq("state", "requested").order("requested_at");
      break;
    case "active":
      request = request.in("state", ["active", "upcoming"]).order("ends_on");
      break;
    case "expiring":
      request = request
        .eq("state", "active")
        .lte("ends_on", addDays(baghdadToday(now), 30))
        .order("ends_on");
      break;
    case "ended":
      request = request
        .in("state", ["expired", "declined", "cancelled"])
        .order("requested_at", { ascending: false });
      break;
  }
  if (query.q) {
    const ids = await customersMatching(supabase, query.q);
    if (ids.length === 0) return { subscriptions: [], more: false };
    request = request.in("user_id", ids);
  }
  const { data, error } = await request;
  if (error) throw new Error(`Subscriptions read failed: ${error.message}`);
  return {
    subscriptions: data.slice(0, query.n).map(toSubscription),
    more: data.length > query.n,
  };
}

/** How many requests wait (the nav). */
export async function subscriptionRequestCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("status", "requested");
  if (error) throw new Error(`Subscription requests count failed: ${error.message}`);
  return count ?? 0;
}

/** Requests waiting, oldest first (A1). */
export async function subscriptionRequests(
  limit: number,
): Promise<{ count: number; oldest: Subscription[] }> {
  const supabase = await createClient();
  const { data, count, error } = await supabase
    .from("subscription_overview")
    .select(OVERVIEW_COLUMNS, { count: "exact" })
    .eq("state", "requested")
    .order("requested_at")
    .limit(limit);
  if (error) throw new Error(`Subscription requests read failed: ${error.message}`);
  return { count: count ?? 0, oldest: data.map(toSubscription) };
}

export type AdminSubscriptionDetails = Subscription & {
  threadId: string | null;
  /** The last day of the address's other running subscription, which a renewal follows. */
  runningUntil: string | null;
  notes: {
    id: number;
    note: string;
    createdAt: string;
    author: { full_name: string | null; phone: string } | null;
  }[];
  orders: { id: string; number: number; status: OrderStatus; slotStartAt: string }[];
};

/** The A7 drawer: the subscription, its notes, its orders and the customer's chat. */
export async function getAdminSubscription(id: string): Promise<AdminSubscriptionDetails | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subscription_overview")
    .select(OVERVIEW_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Subscription read failed: ${error.message}`);
  if (!data) return null;
  const subscription = toSubscription(data);

  const [notes, orders, thread, running] = await Promise.all([
    supabase
      .from("subscription_notes")
      .select(
        "id, note, created_at, author:profiles!subscription_notes_author_id_fkey(full_name, phone)",
      )
      .eq("subscription_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select("id, number, status, slot_start_at")
      .eq("subscription_id", id)
      .order("slot_start_at", { ascending: false }),
    supabase.from("chat_threads").select("id").eq("user_id", subscription.userId).maybeSingle(),
    supabase
      .from("subscriptions")
      .select("ends_on")
      .eq("address_id", subscription.addressId)
      .eq("status", "active")
      .neq("id", id)
      .order("ends_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (notes.error) throw new Error(`Subscription notes read failed: ${notes.error.message}`);
  if (orders.error) throw new Error(`Subscription orders read failed: ${orders.error.message}`);
  if (thread.error) throw new Error(`Thread read failed: ${thread.error.message}`);
  if (running.error) throw new Error(`Running subscription read failed: ${running.error.message}`);

  return {
    ...subscription,
    threadId: thread.data?.id ?? null,
    runningUntil: running.data?.ends_on ?? null,
    notes: notes.data.map((note) => ({
      id: note.id,
      note: note.note,
      createdAt: note.created_at,
      author: note.author,
    })),
    orders: orders.data.map((order) => ({
      id: order.id,
      number: order.number,
      status: order.status,
      slotStartAt: order.slot_start_at,
    })),
  };
}
