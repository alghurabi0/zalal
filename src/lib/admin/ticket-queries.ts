import "server-only";

import type { MediaKind } from "@/lib/booking/media";
import type { RatingTag } from "@/lib/certificates/format";
import { createClient } from "@/lib/supabase/server";
import type { TicketCategory, TicketSource, TicketStatus } from "@/lib/tickets/format";
import { signTicketFiles, type TicketFile } from "@/lib/tickets/queries";

import { likePattern } from "./orders-query";
import { type AdminRatingsQuery, type AdminTicketsQuery, ticketNumberIn } from "./tickets-query";

// A5 (tickets) and A12 (ratings) reads, as the admin: RLS lets admins read
// every ticket, its files and notes, every rating and profile. Pages call
// requireViewer(…, "admin") first.

type Customer = { id: string; full_name: string | null; phone: string };

export type AdminTicketRow = {
  id: string;
  number: number;
  status: TicketStatus;
  source: TicketSource;
  category: TicketCategory | null;
  createdAt: string;
  customer: Customer | null;
  order: { id: string; number: number } | null;
  stars: number | null;
};

type TicketRow = {
  id: string;
  number: number;
  status: TicketStatus;
  source: TicketSource;
  category: TicketCategory | null;
  created_at: string;
  customer: Customer | null;
  orders: { id: string; number: number } | null;
  ratings: { stars: number } | null;
};

const ROW_COLUMNS = `id, number, status, source, category, created_at,
  customer:profiles!tickets_user_id_fkey(id, full_name, phone),
  orders(id, number), ratings(stars)`;

function toRow(row: TicketRow): AdminTicketRow {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    source: row.source,
    category: row.category,
    createdAt: row.created_at,
    customer: row.customer,
    order: row.orders,
    stars: row.ratings?.stars ?? null,
  };
}

/** The customers a search names: by name, or by phone digits (4 or more). */
export async function customersMatching(
  supabase: Awaited<ReturnType<typeof createClient>>,
  search: string,
): Promise<string[]> {
  const digits = search.replace(/\D/g, "");
  const [byName, byPhone] = await Promise.all([
    supabase.from("profiles").select("id").ilike("full_name", likePattern(search)).limit(100),
    digits.length >= 4
      ? supabase
          .from("profiles")
          .select("id")
          // Stored as +9647…; a typed 07… drops its leading 0.
          .like("phone", likePattern(digits.replace(/^0/, "")))
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (byName.error) throw new Error(`Customer search failed: ${byName.error.message}`);
  if (byPhone.error) throw new Error(`Customer search failed: ${byPhone.error.message}`);
  return [...new Set([...byName.data, ...byPhone.data].map((p) => p.id))];
}

/** A5's list: newest first, `n` rows, with whether there are more. */
export async function listAdminTickets(
  query: AdminTicketsQuery,
): Promise<{ tickets: AdminTicketRow[]; more: boolean }> {
  const supabase = await createClient();
  let request = supabase
    .from("tickets")
    .select(ROW_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(query.n + 1);
  if (query.status === "active") request = request.in("status", ["open", "in_progress"]);
  else if (query.status !== "all") request = request.eq("status", query.status);
  if (query.source !== "all") request = request.eq("source", query.source);
  if (query.q) {
    const number = ticketNumberIn(query.q);
    const ids = await customersMatching(supabase, query.q);
    const filters = [
      ...(number !== null ? [`number.eq.${number}`] : []),
      ...(ids.length > 0 ? [`user_id.in.(${ids.join(",")})`] : []),
    ];
    if (filters.length === 0) return { tickets: [], more: false };
    request = request.or(filters.join(","));
  }
  const { data, error } = await request.overrideTypes<TicketRow[], { merge: false }>();
  if (error) throw new Error(`Tickets read failed: ${error.message}`);
  return { tickets: data.slice(0, query.n).map(toRow), more: data.length > query.n };
}

/** Open tickets, for the nav and A1. */
export async function openTicketCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) throw new Error(`Tickets count failed: ${error.message}`);
  return count ?? 0;
}

export type TicketNote = {
  id: number;
  note: string;
  createdAt: string;
  author: { full_name: string | null; phone: string } | null;
};

export type AdminTicketDetails = AdminTicketRow & {
  description: string | null;
  updatedAt: string;
  files: TicketFile[];
  notes: TicketNote[];
  rating: { stars: number; tags: RatingTag[]; comment: string | null } | null;
  /** The customer's chat thread (every ticket posts a message there). */
  threadId: string | null;
};

/** The A5 drawer, or null when there is no such ticket. */
export async function getAdminTicket(id: string): Promise<AdminTicketDetails | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tickets")
    .select(
      `id, number, status, source, category, created_at, updated_at, description, user_id,
       customer:profiles!tickets_user_id_fkey(id, full_name, phone),
       orders(id, number), ratings(stars, tags, comment),
       ticket_media(id, path, media_type, duration_s, created_at),
       ticket_notes(id, note, created_at, author:profiles!ticket_notes_author_id_fkey(full_name, phone))`,
    )
    .eq("id", id)
    .order("created_at", { referencedTable: "ticket_media" })
    .order("created_at", { referencedTable: "ticket_notes", ascending: false })
    .maybeSingle()
    .overrideTypes<
      Omit<TicketRow, "ratings"> & {
        updated_at: string;
        description: string | null;
        user_id: string;
        ratings: { stars: number; tags: RatingTag[]; comment: string | null } | null;
        ticket_media: {
          id: string;
          path: string;
          media_type: MediaKind;
          duration_s: number | null;
        }[];
        ticket_notes: {
          id: number;
          note: string;
          created_at: string;
          author: { full_name: string | null; phone: string } | null;
        }[];
      },
      { merge: false }
    >();
  if (error) throw new Error(`Ticket read failed: ${error.message}`);
  if (!data) return null;

  const [files, thread] = await Promise.all([
    signTicketFiles(supabase, data.ticket_media),
    supabase.from("chat_threads").select("id").eq("user_id", data.user_id).maybeSingle(),
  ]);
  if (thread.error) throw new Error(`Thread read failed: ${thread.error.message}`);
  return {
    ...toRow({ ...data, ratings: data.ratings ? { stars: data.ratings.stars } : null }),
    description: data.description,
    updatedAt: data.updated_at,
    files,
    notes: data.ticket_notes.map((note) => ({
      id: note.id,
      note: note.note,
      createdAt: note.created_at,
      author: note.author,
    })),
    rating: data.ratings,
    threadId: thread.data?.id ?? null,
  };
}

export type AdminRatingRow = {
  orderId: string;
  orderNumber: number;
  stars: number;
  tags: RatingTag[];
  comment: string | null;
  createdAt: string;
  customer: { full_name: string | null; phone: string } | null;
  ticket: { id: string; number: number; status: TicketStatus } | null;
};

/** A12's list, newest first, `n` rows, with whether there are more. */
export async function listAdminRatings(
  query: AdminRatingsQuery,
): Promise<{ ratings: AdminRatingRow[]; more: boolean }> {
  const supabase = await createClient();
  let request = supabase
    .from("ratings")
    .select(
      `order_id, stars, tags, comment, created_at,
       orders!ratings_order_id_fkey(number, customer:profiles!orders_customer_id_fkey(full_name, phone)),
       tickets(id, number, status)`,
    )
    .order("created_at", { ascending: false })
    .limit(query.n + 1);
  if (query.stars) request = request.eq("stars", query.stars);
  const { data, error } = await request.overrideTypes<
    {
      order_id: string;
      stars: number;
      tags: RatingTag[];
      comment: string | null;
      created_at: string;
      orders: {
        number: number;
        customer: { full_name: string | null; phone: string } | null;
      } | null;
      tickets: { id: string; number: number; status: TicketStatus } | null;
    }[],
    { merge: false }
  >();
  if (error) throw new Error(`Ratings read failed: ${error.message}`);
  return {
    ratings: data.slice(0, query.n).map((row) => ({
      orderId: row.order_id,
      orderNumber: row.orders?.number ?? 0,
      stars: row.stars,
      tags: row.tags,
      comment: row.comment,
      createdAt: row.created_at,
      customer: row.orders?.customer ?? null,
      ticket: row.tickets,
    })),
    more: data.length > query.n,
  };
}

/** A12's summary: ratings per star, 1–5. */
export async function ratingSummary(): Promise<{ stars: number; ratings: number }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_rating_summary");
  if (error) throw new Error(`Rating summary failed: ${error.message}`);
  return data.map((row) => ({ stars: row.stars, ratings: Number(row.ratings) }));
}
