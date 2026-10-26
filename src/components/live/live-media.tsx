"use client";

import { useRouter } from "next/navigation";

import { usePostgresChanges } from "@/lib/supabase/use-postgres-changes";

/**
 * Keeps Job progress live (spec §5.14): when the crew attaches a photo or
 * clip to this order, the page's server data is fetched again. Realtime
 * applies the order_media policy to the subscriber, so only the customer's
 * own order's files arrive. Inserts only: DELETE events skip RLS, and a
 * removed file goes with the next load.
 */
export function LiveMedia({ orderId }: { orderId: string }) {
  const router = useRouter();
  usePostgresChanges({
    table: "order_media",
    filter: `order_id=eq.${orderId}`,
    events: ["INSERT"],
    onChange: () => router.refresh(),
  });
  return null;
}
