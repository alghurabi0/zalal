"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import type { CrewPosition } from "@/lib/live/queries";
import { createClient } from "@/lib/supabase/browser";

type PositionRow = CrewPosition & { order_id: string; crew_id: string };

/**
 * The crew's latest position for one order, live (spec §5.13). Starts from
 * the server's reading and takes each newer one from Realtime, which applies
 * the crew_live_location policy to the subscriber: the customer gets rows
 * only while the order is on the way and from the crew now assigned
 * (migration live_job). Only inserts and updates: DELETE events skip RLS.
 */
export function useCrewPosition(
  orderId: string,
  crewId: string | null,
  initial: CrewPosition | null,
  enabled: boolean,
): CrewPosition | null {
  const [position, setPosition] = useState(initial);

  useEffect(() => {
    if (!enabled || !crewId) return;
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let closed = false;
    const take = (row: Partial<PositionRow>) => {
      if (row.crew_id !== crewId || !row.updated_at) return;
      const next = row as PositionRow;
      setPosition((current) =>
        current && Date.parse(current.updated_at) >= Date.parse(next.updated_at)
          ? current
          : {
              lat: next.lat,
              lng: next.lng,
              accuracy_m: next.accuracy_m,
              updated_at: next.updated_at,
            },
      );
    };

    void (async () => {
      // The channel must join with the user's token, or Realtime treats it as
      // a guest and RLS refuses the subscription (spec §3).
      const { data } = await supabase.auth.getSession();
      if (closed || !data.session) return;
      await supabase.realtime.setAuth(data.session.access_token);
      if (closed) return;
      const filter = {
        schema: "public",
        table: "crew_live_location",
        filter: `order_id=eq.${orderId}`,
      };
      channel = supabase
        .channel(`crew-position:${orderId}:${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "INSERT", ...filter }, (payload) => take(payload.new))
        .on("postgres_changes", { event: "UPDATE", ...filter }, (payload) => take(payload.new))
        .subscribe();
    })();

    return () => {
      closed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [orderId, crewId, enabled]);

  return enabled ? position : null;
}
