"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/browser";

/**
 * Keeps a screen's orders live (Home's card, Orders, Order details): when
 * one of the customer's orders changes, the page's server data is fetched
 * again. Realtime applies the orders select policy to each subscriber, so
 * only the customer's own rows arrive (migration orders).
 */
export function LiveOrders({ customerId }: { customerId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let closed = false;

    void (async () => {
      // The channel must join with the user's token, or Realtime treats it as
      // a guest and refuses the subscription. The browser client loads the
      // session from cookies lazily, so hand the token over first.
      const { data } = await supabase.auth.getSession();
      if (closed || !data.session) return;
      await supabase.realtime.setAuth(data.session.access_token);
      if (closed) return;
      // A topic of its own: Next keeps visited pages alive, so Home and
      // Orders can both be mounted, and one leaving must not close the
      // other's channel.
      channel = supabase
        .channel(`orders:${customerId}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: `customer_id=eq.${customerId}`,
          },
          () => router.refresh(),
        )
        .subscribe();
    })();

    return () => {
      closed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [customerId, router]);

  return null;
}
