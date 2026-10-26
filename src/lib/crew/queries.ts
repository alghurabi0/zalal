import "server-only";

import type { Database } from "@/lib/database.types";
import { addDays } from "@/lib/dates";
import type { OrderLine } from "@/lib/orders/queries";
import type { OrderEventRow } from "@/lib/orders/timeline";
import { createClient } from "@/lib/supabase/server";

import type { JobCardData } from "./jobs";
import { JOB_MEDIA_KINDS, type JobMediaKind } from "./media";
import { DONE_JOB_STATUSES, isOpenJob, OPEN_JOB_STATUSES } from "./status";

// The crew's jobs, read as the crew: RLS returns only orders assigned to it
// while it is active (migration orders). The customer's phone comes from
// crew_job_contact(), since crews can't read profiles.

type Enums = Database["public"]["Enums"];

export type JobCard = JobCardData & {
  district: string;
  landmark: string;
  customer_note: string | null;
  lines: OrderLine[];
  /** The customer's booking photos and videos. */
  mediaCount: number;
};

type CardRow = Omit<JobCard, "lines" | "mediaCount"> & {
  order_items: (OrderLine & { id: number })[];
  order_media: { kind: Enums["order_media_kind"] }[];
};

const cardColumns = `id, number, status, service_date, slot_id, slot_start_at, slot_end_at,
  district, landmark, customer_note,
  order_items(id, tank_type, size, qty),
  order_media(kind)`;

function toCard({ order_items, order_media, ...row }: CardRow): JobCard {
  return {
    ...row,
    lines: [...order_items]
      .sort((a, b) => a.id - b.id)
      .map(({ tank_type, size, qty }) => ({ tank_type, size, qty })),
    mediaCount: order_media.filter((file) => file.kind === "customer").length,
  };
}

/**
 * My jobs (C2): open jobs up to tomorrow (earlier ones were never finished)
 * and today's finished ones. `today` is Baghdad's day from the server's clock.
 */
export async function listJobs(today: string): Promise<JobCard[]> {
  const supabase = await createClient();
  const open = OPEN_JOB_STATUSES.join(",");
  const done = DONE_JOB_STATUSES.join(",");
  const { data, error } = await supabase
    .from("orders")
    .select(cardColumns)
    .or(
      `and(status.in.(${open}),service_date.lte.${addDays(today, 1)}),` +
        `and(status.in.(${done}),service_date.eq.${today})`,
    )
    // Newest first, so a pile of unfinished old jobs can't push today's
    // past the limit; groupJobs() sorts each group again.
    .order("slot_start_at", { ascending: false })
    .limit(200)
    .overrideTypes<CardRow[], { merge: false }>();
  if (error) throw new Error(`Jobs read failed: ${error.message}`);
  return data.map(toCard);
}

export type JobMedia = {
  id: string;
  mediaType: Enums["media_type"];
  /** A signed link that lasts an hour (spec §7, Storage). */
  url: string | null;
};

/** The crew's own before/after photos and clips (C3b). */
export type CrewMedia = JobMedia & {
  kind: JobMediaKind;
  /** The object name, so the queue can tell which of its files arrived. */
  path: string;
  durationS: number | null;
};

export type JobDetails = JobCard & {
  /** The crew's folder in order-media is named by it. */
  crew_id: string;
  lat: number;
  lng: number;
  total_iqd: number;
  events: OrderEventRow[];
  /** Staff notes by event id (order_event_notes): the crew reads them. */
  notes: Map<number, string>;
  media: JobMedia[];
  crewMedia: CrewMedia[];
  /** While the job is open (crew_job_contact). */
  contact: { name: string | null; phone: string } | null;
};

type DetailsRow = Omit<CardRow, "order_media"> & {
  crew_id: string;
  lat: number;
  lng: number;
  total_iqd: number;
  order_events: OrderEventRow[];
  order_media: {
    id: string;
    kind: Enums["order_media_kind"];
    media_type: Enums["media_type"];
    path: string;
    duration_s: number | null;
    created_at: string;
  }[];
};

/** Job detail (C3). Null when the job doesn't exist or isn't this crew's. */
export async function getJob(id: string): Promise<JobDetails | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, number, status, service_date, slot_id, slot_start_at, slot_end_at,
       district, landmark, customer_note, crew_id, lat, lng, total_iqd,
       order_items(id, tank_type, size, qty),
       order_events(id, from_status, to_status, actor_role, cancel_reason, is_override, details, created_at),
       order_media(id, kind, media_type, path, duration_s, created_at)`,
    )
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<DetailsRow, { merge: false }>();
  if (error) throw new Error(`Job read failed: ${error.message}`);
  if (!data) return null;

  const sorted = [...data.order_media].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
  );
  // The customer's booking files, and the crew's own (C3b).
  const files = sorted.filter((file) => file.kind === "customer");
  const crewFiles = sorted.flatMap((file) => {
    const kind = JOB_MEDIA_KINDS.find((k) => k === file.kind);
    return kind ? [{ ...file, kind }] : [];
  });

  const [notes, urls, contact] = await Promise.all([
    staffNotes(id),
    signedUrls(sorted.map((file) => file.path)),
    isOpenJob(data.status) ? jobContact(id) : null,
  ]);

  const { crew_id, lat, lng, total_iqd, order_events, ...card } = data;
  return {
    ...toCard(card),
    crew_id,
    lat,
    lng,
    total_iqd,
    events: order_events,
    notes,
    media: files.map((file) => ({
      id: file.id,
      mediaType: file.media_type,
      url: urls.get(file.path) ?? null,
    })),
    crewMedia: crewFiles.map((file) => ({
      id: file.id,
      kind: file.kind,
      mediaType: file.media_type,
      path: file.path,
      durationS: file.duration_s,
      url: urls.get(file.path) ?? null,
    })),
    contact,
  };
}

async function staffNotes(orderId: string): Promise<Map<number, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_event_notes")
    .select("event_id, note")
    .eq("order_id", orderId);
  if (error) throw new Error(`Staff notes read failed: ${error.message}`);
  return new Map(data.map((row) => [row.event_id, row.note]));
}

async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("order-media")
    .createSignedUrls(paths, 60 * 60);
  if (error) throw new Error(`Media links failed: ${error.message}`);
  return new Map(
    data.flatMap((entry) => (entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl]] : [])),
  );
}

async function jobContact(orderId: string): Promise<JobDetails["contact"]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("crew_job_contact", { p_order_id: orderId })
    .maybeSingle();
  // The job closed or moved to another crew between the two reads.
  if (error?.code === "P0002") return null;
  if (error) throw new Error(`Job contact failed (${error.code})`);
  return data ? { name: data.full_name, phone: data.phone } : null;
}

/** C4 starts from the company's sterilant text (settings, A13). */
export async function getSterilantText(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("sterilant_text").single();
  if (error) throw new Error(`Settings read failed: ${error.message}`);
  return data.sterilant_text;
}
