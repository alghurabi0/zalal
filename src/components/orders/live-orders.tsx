"use client";

import { useRouter } from "next/navigation";

import { usePostgresChanges } from "@/lib/supabase/use-postgres-changes";

/**
 * Keeps a screen's orders live (Home's card, Orders, Order details,
 * Tracking, Job progress): when one of the customer's orders changes, the
 * page's server data is fetched again. Realtime applies the orders select
 * policy to each subscriber, so only the customer's own rows arrive
 * (migration orders).
 */
export function LiveOrders({ customerId }: { customerId: string }) {
  const router = useRouter();
  usePostgresChanges({
    table: "orders",
    filter: `customer_id=eq.${customerId}`,
    events: ["INSERT", "UPDATE", "DELETE"],
    onChange: () => router.refresh(),
  });
  return null;
}
