"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/browser";

/**
 * Keeps Job progress live (spec §5.14): when the crew attaches a photo or
 * clip to this order, the page's server data (with its signed links) is
 * fetched again. Realtime applies the order_media policy to the subscriber,
 * so only the customer's own order's files arrive. Inserts only: DELETE
 * events skip RLS, and a removed file goes with the next load.
 */
export function LiveMedia({ orderId }: { orderId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let closed = false;

    void (async () => {
      // Join with the user's token, or RLS refuses the subscription (spec §3).
      const { data } = await supabase.auth.getSession();
      if (closed || !data.session) return;
      await supabase.realtime.setAuth(data.session.access_token);
      if (closed) return;
      channel = supabase
        .channel(`order-media:${orderId}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "order_media",
            filter: `order_id=eq.${orderId}`,
          },
          () => router.refresh(),
        )
        .subscribe();
    })();

    return () => {
      closed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [orderId, router]);

  return null;
}
