import "server-only";

import type { Database } from "@/lib/database.types";
import { addDays } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

import {
  type AdminOrdersQuery,
  likePattern,
  ORDER_STATUSES,
  soonestFirst,
  statusesFor,
} from "./orders-query";

// The admin dashboard's reads (spec §8.2), made as the admin: RLS lets
// admins read every order, profile, crew, slot and staff note. Pages call
// requireViewer(…, "admin") first.

type Enums = Database["public"]["Enums"];
export type OrderStatus = Enums["order_status"];

export type AdminOrderRow = {
  id: string;
  number: number;
  status: OrderStatus;
  service_date: string;
  slot_id: number;
  slot_start_at: string;
  slot_end_at: string;
  district: string;
  total_iqd: number;
  /** Set when the order uses a subscription visit (Phase 6). */
  subscription_id: string | null;
  crew_id: string | null;
  customer: { full_name: string | null; phone: string } | null;
  crew: { name: string } | null;
  /** Tanks in the order (the sum of line quantities). */
  tanks: number;
};

const rowColumns = `id, number, status, service_date, slot_id, slot_start_at, slot_end_at,
  district, total_iqd, subscription_id, crew_id,
  customer:profiles!orders_customer_id_fkey(full_name, phone),
  crew:crews(name),
  order_items(qty)`;

type RawRow = Omit<AdminOrderRow, "tanks"> & { order_items: { qty: number }[] };

function toRow({ order_items, ...row }: RawRow): AdminOrderRow {
  return { ...row, tanks: order_items.reduce((sum, item) => sum + item.qty, 0) };
}

/** A2's table, `query.n` rows at a time. `more` says whether there are others. */
export async function listAdminOrders(
  query: AdminOrdersQuery,
): Promise<{ orders: AdminOrderRow[]; more: boolean }> {
  const supabase = await createClient();
  const ascending = soonestFirst(query);
  let request = supabase
    .from("orders")
    .select(rowColumns)
    .in("status", [...statusesFor(query.status)]);
  if (query.date) request = request.eq("service_date", query.date);
  if (query.from) request = request.gte("service_date", query.from);
  if (query.to) request = request.lte("service_date", query.to);
  if (query.slot) request = request.eq("slot_id", query.slot);
  if (query.district) request = request.ilike("district", likePattern(query.district));
  if (query.crew === "none") request = request.is("crew_id", null);
  else if (query.crew) request = request.eq("crew_id", query.crew);

  const { data, error } = await request
    .order("slot_start_at", { ascending })
    .order("number", { ascending })
    .limit(query.n + 1)
    .overrideTypes<RawRow[], { merge: false }>();
  if (error) throw new Error(`Admin orders read failed: ${error.message}`);
  return { orders: data.slice(0, query.n).map(toRow), more: data.length > query.n };
}

/**
 * A1: the orders of a range of service days counted by status (`to` null =
 * from `from` on). One exact count per status, so the numbers never stop
 * at the API's row limit.
 */
export async function orderCounts(range: {
  from: string;
  to: string | null;
}): Promise<Record<OrderStatus, number>> {
  const supabase = await createClient();
  const counts = await Promise.all(
    ORDER_STATUSES.map(async (status) => {
      let request = supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", status)
        .gte("service_date", range.from);
      if (range.to) request = request.lte("service_date", range.to);
      const { count, error } = await request;
      if (error) throw new Error(`Order counts read failed: ${error.message}`);
      return [status, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts) as Record<OrderStatus, number>;
}

/** A1: orders waiting for confirmation, soonest first. */
export async function pendingConfirmations(
  limit: number,
): Promise<{ orders: AdminOrderRow[]; total: number }> {
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from("orders")
    .select(rowColumns, { count: "exact" })
    .eq("status", "pending_confirmation")
    .order("slot_start_at", { ascending: true })
    .order("number", { ascending: true })
    .limit(limit)
    .overrideTypes<RawRow[], { merge: false }>();
  if (error) throw new Error(`Pending orders read failed: ${error.message}`);
  return { orders: data.map(toRow), total: count ?? data.length };
}

export type CrewOption = { id: string; name: string; active: boolean };

/** Every crew, active first, for filters and assignment. */
export async function listCrews(): Promise<CrewOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crews")
    .select("id, name, active")
    .order("active", { ascending: false })
    .order("name");
  if (error) throw new Error(`Crews read failed: ${error.message}`);
  return data;
}

export type BoardCell = Database["public"]["Functions"]["admin_slot_board"]["Returns"][number];

/** The date × slot board: places taken per day and slot (admin_slot_board). */
export async function slotBoard(from: string, days: number): Promise<BoardCell[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_slot_board", {
    p_from: from,
    p_to: addDays(from, days - 1),
  });
  if (error) throw new Error(`Slot board read failed: ${error.message}`);
  return data;
}

// The order drawer --------------------------------------------------------------

export type AdminOrderEvent = {
  id: number;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_role: Enums["app_role"] | null;
  actor: { full_name: string | null } | null;
  cancel_reason: Enums["cancel_reason"] | null;
  is_override: boolean;
  details: unknown;
  created_at: string;
};

export type AdminOrderMedia = {
  id: string;
  kind: Enums["order_media_kind"];
  mediaType: Enums["media_type"];
  url: string | null;
};

export type CrewChange = {
  id: number;
  at: string;
  admin: string | null;
  from: string | null;
  to: string | null;
};

export type AdminOrderDetails = AdminOrderRow & {
  customer_id: string;
  address_id: string;
  landmark: string;
  lat: number;
  lng: number;
  customer_note: string | null;
  payment_method: Enums["payment_method"];
  cash_collected: boolean;
  created_at: string;
  items: {
    tank_type: Enums["tank_type"];
    size: Enums["tank_size"];
    qty: number;
    unit_price_iqd: number;
  }[];
  events: AdminOrderEvent[];
  /** Staff notes by event id (order_event_notes). */
  notes: Map<number, string>;
  media: AdminOrderMedia[];
  crewChanges: CrewChange[];
  /** Issued on completion (migration certificates). */
  certificate: { id: string; public_code: string; pdf_path: string | null } | null;
  rating: AdminRating | null;
};

export type AdminRating = {
  stars: number;
  tags: Enums["rating_tag"][];
  comment: string | null;
  created_at: string;
  /** The ticket a rating of 3 stars or fewer opened. */
  ticket: { id: string; number: number; status: Enums["ticket_status"] } | null;
};

type DetailsRaw = Omit<RawRow, "order_items"> & {
  customer_id: string;
  address_id: string;
  landmark: string;
  lat: number;
  lng: number;
  customer_note: string | null;
  payment_method: Enums["payment_method"];
  cash_collected: boolean;
  created_at: string;
  order_items: (AdminOrderDetails["items"][number] & { id: number })[];
  order_events: AdminOrderEvent[];
  order_media: {
    id: string;
    kind: AdminOrderMedia["kind"];
    media_type: AdminOrderMedia["mediaType"];
    path: string;
    created_at: string;
  }[];
  certificates: AdminOrderDetails["certificate"];
  ratings: (Omit<AdminRating, "ticket"> & { tickets: AdminRating["ticket"] }) | null;
};

/** The A2 drawer. Null when the order doesn't exist. */
export async function getAdminOrder(id: string): Promise<AdminOrderDetails | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, number, status, service_date, slot_id, slot_start_at, slot_end_at, district,
       total_iqd, subscription_id, crew_id, customer_id, address_id, landmark, lat, lng,
       customer_note, payment_method,
       cash_collected, created_at,
       customer:profiles!orders_customer_id_fkey(full_name, phone),
       crew:crews(name),
       order_items(id, tank_type, size, qty, unit_price_iqd),
       order_events(id, from_status, to_status, actor_role, cancel_reason, is_override, details,
         created_at, actor:profiles(full_name)),
       order_media(id, kind, media_type, path, created_at),
       certificates(id, public_code, pdf_path),
       ratings(stars, tags, comment, created_at, tickets(id, number, status))`,
    )
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<DetailsRaw, { merge: false }>();
  if (error) throw new Error(`Admin order read failed: ${error.message}`);
  if (!data) return null;

  const [notes, crewChanges, urls] = await Promise.all([
    staffNotes(id),
    crewHistory(id),
    signedUrls(data.order_media.map((file) => file.path)),
  ]);

  const { order_items, order_events, order_media, certificates, ratings, ...rest } = data;
  const items = [...order_items].sort((a, b) => a.id - b.id);
  return {
    ...rest,
    tanks: items.reduce((sum, item) => sum + item.qty, 0),
    items: items.map(({ tank_type, size, qty, unit_price_iqd }) => ({
      tank_type,
      size,
      qty,
      unit_price_iqd,
    })),
    events: [...order_events].sort(
      // Compare instants: Postgres drops a zero fraction, so the strings don't sort.
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id,
    ),
    notes,
    media: [...order_media]
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .map((file) => ({
        id: file.id,
        kind: file.kind,
        mediaType: file.media_type,
        url: urls.get(file.path) ?? null,
      })),
    crewChanges,
    certificate: certificates,
    rating: ratings && {
      stars: ratings.stars,
      tags: ratings.tags,
      comment: ratings.comment,
      created_at: ratings.created_at,
      ticket: ratings.tickets,
    },
  };
}

export type OpenTicket = {
  id: string;
  number: number;
  source: Enums["ticket_source"];
  category: Enums["ticket_category"] | null;
  created_at: string;
  order: { id: string; number: number } | null;
  stars: number | null;
};

/** A1's open tickets: the count and the newest few, each opening the A5 drawer. */
export async function openTickets(
  limit: number,
): Promise<{ total: number; tickets: OpenTicket[] }> {
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from("tickets")
    .select("id, number, source, category, created_at, orders(id, number), ratings(stars)", {
      count: "exact",
    })
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(limit)
    .overrideTypes<
      {
        id: string;
        number: number;
        source: Enums["ticket_source"];
        category: Enums["ticket_category"] | null;
        created_at: string;
        orders: { id: string; number: number } | null;
        ratings: { stars: number } | null;
      }[],
      { merge: false }
    >();
  if (error) throw new Error(`Tickets read failed: ${error.message}`);
  return {
    total: count ?? data.length,
    tickets: data.map(({ orders, ratings, ...ticket }) => ({
      ...ticket,
      order: orders,
      stars: ratings?.stars ?? null,
    })),
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

/** Crew changes come from the audit log (assign_crew writes no order event). */
async function crewHistory(orderId: string): Promise<CrewChange[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("admin_audit_log")
    .select("id, diff, created_at, admin:profiles(full_name)")
    .eq("action", "order.assign_crew")
    .eq("entity", "orders")
    .eq("entity_id", orderId)
    .order("created_at", { ascending: true })
    .overrideTypes<
      {
        id: number;
        diff: unknown;
        created_at: string;
        admin: { full_name: string | null } | null;
      }[],
      { merge: false }
    >();
  if (error) throw new Error(`Crew history read failed: ${error.message}`);
  const crewIdOf = (diff: unknown, key: "from" | "to") => {
    const value = diff && typeof diff === "object" ? (diff as Record<string, unknown>)[key] : null;
    return typeof value === "string" ? value : null;
  };
  return data.map((row) => ({
    id: row.id,
    at: row.created_at,
    admin: row.admin?.full_name ?? null,
    from: crewIdOf(row.diff, "from"),
    to: crewIdOf(row.diff, "to"),
  }));
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
