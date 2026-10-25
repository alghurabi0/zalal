import "server-only";

import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

import { CURRENT_STATUSES, type OrdersTab, PAST_STATUSES, pickActiveOrder } from "./status";
import type { OrderEventRow } from "./timeline";

// The customer's orders, read as the customer: RLS returns only their own.

type TankType = Database["public"]["Enums"]["tank_type"];
type TankSize = Database["public"]["Enums"]["tank_size"];
type AddressLabel = Database["public"]["Enums"]["address_label"];

export type OrderLine = { tank_type: TankType; size: TankSize; qty: number };

export type OrderSummary = {
  id: string;
  number: number;
  status: Database["public"]["Enums"]["order_status"];
  service_date: string;
  slot_id: number;
  slot_start_at: string;
  slot_end_at: string;
  total_iqd: number;
  district: string;
  /** The address's label, while the address is still live. */
  label: AddressLabel | null;
  lines: OrderLine[];
};

const baseColumns =
  "id, number, status, service_date, slot_id, slot_start_at, slot_end_at, total_iqd, district, addresses(label)";
const summaryColumns = `${baseColumns}, order_items(id, tank_type, size, qty)`;

type SummaryRow = Omit<OrderSummary, "label" | "lines"> & {
  addresses: { label: AddressLabel } | null;
  order_items: (OrderLine & { id: number })[];
};

function toSummary({ addresses, order_items, ...row }: SummaryRow): OrderSummary {
  return {
    ...row,
    label: addresses?.label ?? null,
    lines: [...order_items]
      .sort((a, b) => a.id - b.id)
      .map(({ tank_type, size, qty }) => ({ tank_type, size, qty })),
  };
}

/**
 * Orders (spec §5.12), `limit` at a time. Current orders come soonest
 * first, past ones newest first. `more` says whether there are others.
 */
export async function listOrders(
  tab: OrdersTab,
  limit: number,
): Promise<{ orders: OrderSummary[]; more: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(summaryColumns)
    .in("status", tab === "current" ? [...CURRENT_STATUSES] : [...PAST_STATUSES])
    .order("slot_start_at", { ascending: tab === "current" })
    .order("number", { ascending: tab === "current" })
    .limit(limit + 1)
    .overrideTypes<SummaryRow[], { merge: false }>();
  if (error) throw new Error(`Orders read failed: ${error.message}`);
  return { orders: data.slice(0, limit).map(toSummary), more: data.length > limit };
}

/** Home's active-order card (spec §5.5), chosen by pickActiveOrder(). */
export async function activeOrder(now: Date): Promise<OrderSummary | null> {
  const { orders } = await listOrders("current", 20);
  return pickActiveOrder(orders, now);
}

export type OrderMedia = {
  id: string;
  mediaType: Database["public"]["Enums"]["media_type"];
  durationS: number | null;
  /** A signed link that lasts an hour (spec §7, Storage). */
  url: string | null;
};

export type OrderDetails = OrderSummary & {
  landmark: string;
  customer_note: string | null;
  payment_method: Database["public"]["Enums"]["payment_method"];
  items: (OrderLine & { unit_price_iqd: number })[];
  events: OrderEventRow[];
  media: OrderMedia[];
};

type DetailsRow = Omit<SummaryRow, "order_items"> & {
  landmark: string;
  customer_note: string | null;
  payment_method: OrderDetails["payment_method"];
  order_items: (OrderLine & { id: number; unit_price_iqd: number })[];
  order_events: OrderEventRow[];
  order_media: {
    id: string;
    kind: Database["public"]["Enums"]["order_media_kind"];
    media_type: OrderMedia["mediaType"];
    path: string;
    duration_s: number | null;
    created_at: string;
  }[];
};

/** Order details (N4). Null when the order doesn't exist or isn't theirs. */
export async function getOrder(id: string): Promise<OrderDetails | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      `${baseColumns}, landmark, customer_note, payment_method,
       order_items(id, tank_type, size, qty, unit_price_iqd),
       order_events(id, from_status, to_status, actor_role, cancel_reason, is_override, details, created_at),
       order_media(id, kind, media_type, path, duration_s, created_at)`,
    )
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<DetailsRow, { merge: false }>();
  if (error) throw new Error(`Order read failed: ${error.message}`);
  if (!data) return null;

  const { order_items, order_events, order_media, ...rest } = data;
  const items = [...order_items].sort((a, b) => a.id - b.id);
  // The customer's own photos and videos; the crew's come with Job progress (Phase 4).
  const files = order_media
    .filter((file) => file.kind === "customer")
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  let urls = new Map<string, string>();
  if (files.length > 0) {
    const { data: signed, error: signError } = await supabase.storage
      .from("order-media")
      .createSignedUrls(
        files.map((file) => file.path),
        60 * 60,
      );
    if (signError) throw new Error(`Media links failed: ${signError.message}`);
    urls = new Map(
      signed.flatMap((entry) =>
        entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl]] : [],
      ),
    );
  }

  return {
    ...toSummary({ ...rest, order_items: items }),
    landmark: rest.landmark,
    customer_note: rest.customer_note,
    payment_method: rest.payment_method,
    items: items.map(({ tank_type, size, qty, unit_price_iqd }) => ({
      tank_type,
      size,
      qty,
      unit_price_iqd,
    })),
    events: order_events,
    media: files.map((file) => ({
      id: file.id,
      mediaType: file.media_type,
      durationS: file.duration_s,
      url: urls.get(file.path) ?? null,
    })),
  };
}
