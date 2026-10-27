import "server-only";

import type { Database } from "@/lib/database.types";
import type { MediaKind } from "@/lib/booking/media";
import { createClient } from "@/lib/supabase/server";

import {
  ISSUE_ORDER_DAYS,
  type TicketCategory,
  type TicketSource,
  type TicketStatus,
} from "./format";
import { TICKET_MEDIA_BUCKET } from "./media";

// The customer's reads for the Issue report (spec §5.17) and My reports
// (N11), as the logged-in customer (RLS keeps them to their own rows).

type TankType = Database["public"]["Enums"]["tank_type"];
type Client = Awaited<ReturnType<typeof createClient>>;

const SIGNED_URL_SECONDS = 60 * 60;

export type IssueOrder = {
  id: string;
  number: number;
  /** A calendar day in Baghdad. */
  serviceDate: string;
  /** The tank types of its lines, in order. */
  tanks: TankType[];
};

/**
 * The orders an Issue report can name: slots from 90 days ago on (upcoming
 * ones too, any status), newest first.
 */
export async function issueOrders(now: Date, client?: Client): Promise<IssueOrder[]> {
  const supabase = client ?? (await createClient());
  const from = new Date(now.getTime() - ISSUE_ORDER_DAYS * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from("orders")
    .select("id, number, service_date, order_items(tank_type)")
    .gte("slot_start_at", from.toISOString())
    .order("slot_start_at", { ascending: false })
    // Every order in the window; the cap only guards the select's size.
    .limit(200);
  if (error) throw new Error(`Issue orders failed: ${error.message}`);
  return data.map((order) => ({
    id: order.id,
    number: order.number,
    serviceDate: order.service_date,
    tanks: order.order_items.map((item) => item.tank_type),
  }));
}

/** The hours the Issue report promises an answer within (A13). */
export async function ticketResponseHours(client?: Client): Promise<number> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("settings")
    .select("ticket_response_hours")
    .limit(1)
    .single();
  if (error) throw new Error(`Settings read failed: ${error.message}`);
  return data.ticket_response_hours;
}

export type MyTicket = {
  id: string;
  number: number;
  status: TicketStatus;
  source: TicketSource;
  category: TicketCategory | null;
  createdAt: string;
  updatedAt: string;
  order: { id: string; number: number } | null;
  /** The stars of the rating that opened it (rating tickets). */
  stars: number | null;
};

type TicketRow = {
  id: string;
  number: number;
  status: TicketStatus;
  source: TicketSource;
  category: TicketCategory | null;
  created_at: string;
  updated_at: string;
  orders: { id: string; number: number } | null;
  ratings: { stars: number } | null;
};

const TICKET_COLUMNS =
  "id, number, status, source, category, created_at, updated_at, orders(id, number), ratings(stars)";

function toTicket(row: TicketRow): MyTicket {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    source: row.source,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    order: row.orders,
    stars: row.ratings?.stars ?? null,
  };
}

/** N11: the customer's tickets, newest first. */
export async function listMyTickets(): Promise<MyTicket[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tickets")
    .select(TICKET_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(100)
    .overrideTypes<TicketRow[], { merge: false }>();
  if (error) throw new Error(`Tickets read failed: ${error.message}`);
  return data.map(toTicket);
}

export type TicketFile = {
  id: string;
  kind: MediaKind;
  durationS: number | null;
  /** A one-hour signed link; null if the file is gone. */
  url: string | null;
};

export type MyTicketDetails = MyTicket & {
  description: string | null;
  files: TicketFile[];
};

/** N11 detail, or null when the ticket isn't the customer's. */
export async function getMyTicket(id: string): Promise<MyTicketDetails | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tickets")
    .select(`${TICKET_COLUMNS}, description, ticket_media(id, path, media_type, duration_s)`)
    .eq("id", id)
    .order("created_at", { referencedTable: "ticket_media" })
    .maybeSingle()
    .overrideTypes<
      TicketRow & {
        description: string | null;
        ticket_media: {
          id: string;
          path: string;
          media_type: MediaKind;
          duration_s: number | null;
        }[];
      },
      { merge: false }
    >();
  if (error) throw new Error(`Ticket read failed: ${error.message}`);
  if (!data) return null;
  return {
    ...toTicket(data),
    description: data.description,
    files: await signTicketFiles(supabase, data.ticket_media),
  };
}

/** Signs a ticket's files for an hour (the customer's or an admin's client). */
export async function signTicketFiles(
  supabase: Client,
  media: { id: string; path: string; media_type: MediaKind; duration_s: number | null }[],
): Promise<TicketFile[]> {
  let urls = new Map<string, string>();
  if (media.length > 0) {
    const { data: signed, error } = await supabase.storage
      .from(TICKET_MEDIA_BUCKET)
      .createSignedUrls(
        media.map((file) => file.path),
        SIGNED_URL_SECONDS,
      );
    if (error) throw new Error(`Signing failed: ${error.message}`);
    urls = new Map(
      signed.flatMap((entry) =>
        entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl] as const] : [],
      ),
    );
  }
  return media.map((file) => ({
    id: file.id,
    kind: file.media_type,
    durationS: file.duration_s,
    url: urls.get(file.path) ?? null,
  }));
}
