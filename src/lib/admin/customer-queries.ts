import "server-only";

import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

import type { AdminCustomersQuery } from "./customers-query";

// A6's reads (spec §8.2), as the admin: RLS lets admins read every profile,
// order and chat thread. Pages call requireViewer(…, "admin") first.

export type AdminCustomerRow =
  Database["public"]["Functions"]["admin_customers"]["Returns"][number];

/** A6's list: `n` rows in the query's sort, the number that match, and whether there are more. */
export async function listAdminCustomers(
  query: AdminCustomersQuery,
): Promise<{ customers: AdminCustomerRow[]; total: number; more: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_customers", {
    p_search: query.q,
    p_sort: query.sort,
    p_limit: query.n,
  });
  if (error) throw new Error(`Customers read failed: ${error.message}`);
  const total = data[0]?.total ?? 0;
  return { customers: data, total, more: total > data.length };
}

export type AdminCustomer = {
  id: string;
  fullName: string | null;
  phone: string;
  createdAt: string;
  ordersCount: number;
  threadId: string | null;
};

/** The A6 drawer's header, or null unless it is a live customer account. */
export async function getAdminCustomer(id: string): Promise<AdminCustomer | null> {
  const supabase = await createClient();
  const [profile, orders, thread] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, created_at, role, deleted_at")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", id),
    supabase.from("chat_threads").select("id").eq("user_id", id).maybeSingle(),
  ]);
  for (const result of [profile, orders, thread]) {
    if (result.error) throw new Error(`Customer read failed: ${result.error.message}`);
  }
  const row = profile.data;
  if (!row || row.role !== "customer" || row.deleted_at || !row.phone) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    createdAt: row.created_at,
    ordersCount: orders.count ?? 0,
    threadId: thread.data?.id ?? null,
  };
}
