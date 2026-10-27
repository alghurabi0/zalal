"use client";

import { useRouter } from "next/navigation";

import { usePostgresChanges } from "@/lib/supabase/use-postgres-changes";

/**
 * Keeps Notifications and the Home bell live (spec §5.5, §5.7): a new
 * notification or a read mark (from another tab, Chat, or a push tap) fetches
 * the page's server data again. Realtime applies the notifications policy,
 * so only the user's own rows arrive. Inserts and updates only: the nightly
 * cleanup's deletes go to every subscriber. A change made before the
 * subscription was live is read again in onSubscribed.
 */
export function LiveNotifications({ userId }: { userId: string }) {
  const router = useRouter();
  usePostgresChanges({
    table: "notifications",
    filter: `user_id=eq.${userId}`,
    events: ["INSERT", "UPDATE"],
    onChange: () => router.refresh(),
    onSubscribed: () => router.refresh(),
  });
  return null;
}
