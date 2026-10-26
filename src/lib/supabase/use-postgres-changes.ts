"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

import { createClient } from "./browser";

type Event = "INSERT" | "UPDATE" | "DELETE";

/**
 * Subscribes to Postgres changes on one table while mounted. The channel
 * joins with the user's token, or Realtime treats it as a guest and RLS
 * refuses the subscription (spec §3). Each subscription gets a topic of its
 * own: Next keeps visited pages alive, so two screens can listen at once,
 * and one leaving must not close the other's channel.
 *
 * Avoid DELETE on tables other users write to: Realtime sends DELETE events
 * to every subscriber without RLS.
 */
export function usePostgresChanges({
  table,
  filter,
  events,
  onChange,
  onSubscribed,
  enabled = true,
}: {
  table: string;
  /** A Realtime filter such as `order_id=eq.<id>`. */
  filter?: string;
  events: readonly Event[];
  onChange: (row: Record<string, unknown>, event: Event) => void;
  /**
   * The subscription is live (first join and every rejoin after a dropped
   * connection). Changes made before it are not sent: read them here.
   */
  onSubscribed?: () => void;
  enabled?: boolean;
}) {
  // The latest callbacks, without resubscribing on every render.
  const handler = useRef(onChange);
  const subscribed = useRef(onSubscribed);
  useEffect(() => {
    handler.current = onChange;
    subscribed.current = onSubscribed;
  });
  const eventsKey = events.join(",");

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let closed = false;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (closed || !data.session) return;
      await supabase.realtime.setAuth(data.session.access_token);
      if (closed) return;
      channel = supabase.channel(`${table}:${filter ?? "all"}:${crypto.randomUUID()}`);
      for (const event of eventsKey.split(",") as Event[]) {
        channel.on(
          "postgres_changes",
          { event, schema: "public", table, ...(filter ? { filter } : {}) },
          (payload) =>
            handler.current(
              (event === "DELETE" ? payload.old : payload.new) as Record<string, unknown>,
              event,
            ),
        );
      }
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") subscribed.current?.();
      });
    })();

    return () => {
      closed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [table, filter, eventsKey, enabled]);
}
