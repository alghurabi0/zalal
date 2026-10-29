import "server-only";

import type { Database } from "@/lib/database.types";
import type { OrderStatus } from "@/lib/orders/status";
import { companyPhones } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

// Tracking (spec §5.13) and Job progress (§5.14), read as the customer: RLS
// returns only their own orders, and the crew's position only while the
// order is on the way (migration live_job).

export type CrewPosition = {
  lat: number;
  lng: number;
  accuracy_m: number;
  /** The server's time of the last position. */
  updated_at: string;
};

export type TrackingData = {
  id: string;
  number: number;
  status: OrderStatus;
  /** The home pin: the order's copy of the address. */
  home: { lat: number; lng: number };
  crewId: string | null;
  position: CrewPosition | null;
  /** The company phones (companyPhones); none until the owner sets one (A13). */
  companyPhones: string[];
  /** The server's clock when this was read (ms), for the position's age. */
  readAt: number;
};

/** Null when the order doesn't exist or isn't theirs. */
export async function getTracking(id: string): Promise<TrackingData | null> {
  const supabase = await createClient();
  const [order, settings] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, number, status, lat, lng, crew_id, crew_live_location(crew_id, lat, lng, accuracy_m, updated_at)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("settings").select("company_phone, company_phone_2").single(),
  ]);
  if (order.error) throw new Error(`Order read failed: ${order.error.message}`);
  if (settings.error) throw new Error(`Settings read failed: ${settings.error.message}`);
  if (!order.data) return null;
  const { lat, lng, crew_id, crew_live_location: live, ...rest } = order.data;
  // RLS returns it only while on the way; a position from a crew the job
  // was taken from doesn't count.
  const position: CrewPosition | null =
    live && live.crew_id === crew_id
      ? {
          lat: live.lat,
          lng: live.lng,
          accuracy_m: live.accuracy_m,
          updated_at: live.updated_at,
        }
      : null;

  return {
    ...rest,
    home: { lat, lng },
    crewId: crew_id,
    position,
    companyPhones: companyPhones(settings.data),
    readAt: Date.now(),
  };
}

type MediaKind = Database["public"]["Enums"]["order_media_kind"];

export type JobFile = {
  id: string;
  kind: Exclude<MediaKind, "customer">;
  mediaType: Database["public"]["Enums"]["media_type"];
  durationS: number | null;
  /** A signed link that lasts an hour (spec §7, Storage); null if Storage refused. */
  url: string | null;
};

export type JobProgressData = {
  id: string;
  number: number;
  status: OrderStatus;
  /** When the crew arrived, started and finished (the latest of each). */
  times: Partial<Record<"arrived" | "in_progress" | "completed", string>>;
  files: JobFile[];
};

type ProgressRow = {
  id: string;
  number: number;
  status: OrderStatus;
  order_events: { to_status: OrderStatus; created_at: string }[];
  order_media: {
    id: string;
    kind: MediaKind;
    media_type: JobFile["mediaType"];
    path: string;
    duration_s: number | null;
    created_at: string;
  }[];
};

/** Null when the order doesn't exist or isn't theirs. */
export async function getJobProgress(id: string): Promise<JobProgressData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, number, status,
       order_events(to_status, created_at),
       order_media(id, kind, media_type, path, duration_s, created_at)`,
    )
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<ProgressRow, { merge: false }>();
  if (error) throw new Error(`Order read failed: ${error.message}`);
  if (!data) return null;

  const times: JobProgressData["times"] = {};
  for (const event of data.order_events) {
    if (
      event.to_status === "arrived" ||
      event.to_status === "in_progress" ||
      event.to_status === "completed"
    ) {
      const seen = times[event.to_status];
      if (!seen || Date.parse(event.created_at) > Date.parse(seen)) {
        times[event.to_status] = event.created_at;
      }
    }
  }

  // The crew's files, oldest first; the customer's own are on Order details.
  const crewFiles = data.order_media
    .filter((file) => file.kind !== "customer")
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  let urls = new Map<string, string>();
  if (crewFiles.length > 0) {
    const { data: signed, error: signError } = await supabase.storage
      .from("order-media")
      .createSignedUrls(
        crewFiles.map((file) => file.path),
        60 * 60,
      );
    if (signError) throw new Error(`Signing failed: ${signError.message}`);
    urls = new Map(
      signed.flatMap((entry) =>
        entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl] as const] : [],
      ),
    );
  }

  return {
    id: data.id,
    number: data.number,
    status: data.status,
    times,
    files: crewFiles.map((file) => ({
      id: file.id,
      kind: file.kind as JobFile["kind"],
      mediaType: file.media_type,
      durationS: file.duration_s,
      url: urls.get(file.path) ?? null,
    })),
  };
}
