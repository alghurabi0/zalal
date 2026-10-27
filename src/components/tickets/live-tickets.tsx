"use client";

import { useRouter } from "next/navigation";

import { usePostgresChanges } from "@/lib/supabase/use-postgres-changes";

/**
 * Keeps a tickets screen live (My reports N11, A1, A5): a new ticket or a
 * status change fetches the page's server data again. Realtime applies the
 * tickets select policy, so a customer gets only their own rows and admins
 * every one (migration tickets_app). Inserts and updates only: tickets are
 * never deleted.
 */
export function LiveTickets({ userId }: { userId?: string }) {
  const router = useRouter();
  usePostgresChanges({
    table: "tickets",
    filter: userId ? `user_id=eq.${userId}` : undefined,
    events: ["INSERT", "UPDATE"],
    onChange: () => router.refresh(),
  });
  return null;
}
