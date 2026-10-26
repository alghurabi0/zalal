"use client";

import { useState } from "react";

import type { CrewPosition } from "@/lib/live/queries";
import { usePostgresChanges } from "@/lib/supabase/use-postgres-changes";

type PositionRow = CrewPosition & { order_id: string; crew_id: string };

/** The newer of two positions (by the server's time). */
export function newer<T extends CrewPosition>(a: T | null, b: T | null): T | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.updated_at) > Date.parse(a.updated_at) ? b : a;
}

/**
 * The crew's latest position for one order, live (spec §5.13). Starts from
 * the server's reading and takes each newer one from Realtime, which applies
 * the crew_live_location policy to the subscriber: the customer gets rows
 * only while the order is on the way and from the crew now assigned
 * (migration live_job).
 */
export function useCrewPosition(
  orderId: string,
  crewId: string | null,
  initial: CrewPosition | null,
  enabled: boolean,
): CrewPosition | null {
  const [live, setLive] = useState<CrewPosition | null>(null);
  usePostgresChanges({
    table: "crew_live_location",
    filter: `order_id=eq.${orderId}`,
    events: ["INSERT", "UPDATE"],
    enabled: enabled && crewId !== null,
    onChange: (value) => {
      const row = value as Partial<PositionRow>;
      if (row.crew_id !== crewId || !row.updated_at) return;
      const { lat, lng, accuracy_m, updated_at } = row as PositionRow;
      setLive((current) => newer(current, { lat, lng, accuracy_m, updated_at }));
    },
  });
  return enabled ? newer(initial, live) : null;
}
