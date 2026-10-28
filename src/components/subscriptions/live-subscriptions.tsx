"use client";

import { useRouter } from "next/navigation";

import { usePostgresChanges } from "@/lib/supabase/use-postgres-changes";

/**
 * Keeps a subscription screen live (N8, Profile, A1, A7): a new request or a
 * change fetches the page's server data again. Realtime applies the
 * subscriptions select policy, so a customer gets only their own rows and
 * admins every one (migration subscriptions). Inserts and updates only:
 * subscriptions are never deleted. For a customer, their orders too (the
 * visits are counted from them).
 */
export function LiveSubscriptions({ userId }: { userId?: string }) {
  const router = useRouter();
  usePostgresChanges({
    table: "subscriptions",
    filter: userId ? `user_id=eq.${userId}` : undefined,
    events: ["INSERT", "UPDATE"],
    onChange: () => router.refresh(),
  });
  // Visits come from orders: a customer's covered order booked, moved or
  // finished changes the counts too.
  usePostgresChanges({
    table: "orders",
    filter: `customer_id=eq.${userId}`,
    events: ["INSERT", "UPDATE"],
    onChange: () => router.refresh(),
    enabled: userId !== undefined,
  });
  return null;
}
