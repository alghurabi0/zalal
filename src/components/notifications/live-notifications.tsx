"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { usePostgresChanges } from "@/lib/supabase/use-postgres-changes";

/**
 * Keeps Notifications live (spec §5.7): a new notification or a read mark
 * (from another tab, Chat, or a push tap) fetches the page's server data
 * again. Realtime applies the notifications policy, so only the user's own
 * rows arrive. "قراءة الكل" sends one event per row, so a burst refreshes
 * once. Inserts and updates only: the nightly cleanup's deletes go to every
 * subscriber. A change made before the subscription was live is read again
 * in onSubscribed.
 */
export function LiveNotifications({ userId }: { userId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const refresh = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 300);
  };

  usePostgresChanges({
    table: "notifications",
    filter: `user_id=eq.${userId}`,
    events: ["INSERT", "UPDATE"],
    onChange: refresh,
    onSubscribed: refresh,
  });
  return null;
}
