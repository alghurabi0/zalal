import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import type { OrderStatus } from "@/lib/orders/status";
import { createClient } from "@/lib/supabase/server";

import { normalizePublicCode, type RatingTag } from "./format";

// The certificate as Report (spec §5.15), the print page (§10.1) and N15 read
// it. Report and the print page read the same record, so all three match.

type Client = SupabaseClient<Database>;
type TankType = Database["public"]["Enums"]["tank_type"];
type TankSize = Database["public"]["Enums"]["tank_size"];
type MediaType = Database["public"]["Enums"]["media_type"];

export type CertificateTank = { tank_type: TankType; size: TankSize; qty: number };

export type CertificateFile = {
  id: string;
  mediaType: MediaType;
  durationS: number | null;
  /** A signed link that lasts an hour; null if Storage refused. */
  url: string | null;
};

export type CertificateRating = {
  stars: number;
  tags: RatingTag[];
  comment: string | null;
  /** The ticket a low rating opened. */
  ticketNumber: number | null;
};

export type CertificateData = {
  id: string;
  publicCode: string;
  issuedAt: string;
  /** Null after an admin override with no sterilant anywhere (migration certificates). */
  sterilant: string | null;
  chlorine: number | null;
  /** A Baghdad calendar day, YYYY-MM-DD. */
  nextDueOn: string;
  pdfPath: string | null;
  order: {
    id: string;
    number: number;
    status: OrderStatus;
    serviceDate: string;
    slotStartAt: string;
    slotEndAt: string;
    district: string;
    landmark: string;
    tanks: CertificateTank[];
  };
  customer: { name: string | null; phone: string | null; remindersEnabled: boolean };
  before: CertificateFile[];
  after: CertificateFile[];
  clips: CertificateFile[];
  rating: CertificateRating | null;
  /** settings.company_phone (footer); null until set in A13. */
  companyPhone: string | null;
  /** settings.certificate_text (§10.1 item 4). */
  serviceText: string;
};

type Row = {
  id: string;
  public_code: string;
  issued_at: string;
  sterilant: string | null;
  residual_chlorine_mg_l: number | null;
  next_due_on: string;
  pdf_path: string | null;
  orders: {
    id: string;
    number: number;
    status: OrderStatus;
    service_date: string;
    slot_start_at: string;
    slot_end_at: string;
    district: string;
    landmark: string;
    order_items: (CertificateTank & { id: number })[];
    order_media: {
      id: string;
      kind: Database["public"]["Enums"]["order_media_kind"];
      media_type: MediaType;
      path: string;
      duration_s: number | null;
      created_at: string;
    }[];
    profiles: { full_name: string | null; phone: string; reminders_enabled: boolean } | null;
    ratings: {
      stars: number;
      tags: RatingTag[];
      comment: string | null;
      tickets: { number: number } | null;
    } | null;
  };
};

const SELECT = `id, public_code, issued_at, sterilant, residual_chlorine_mg_l, next_due_on, pdf_path,
  orders!inner(
    id, number, status, service_date, slot_start_at, slot_end_at, district, landmark,
    order_items(id, tank_type, size, qty),
    order_media(id, kind, media_type, path, duration_s, created_at),
    profiles(full_name, phone, reminders_enabled),
    ratings(stars, tags, comment, tickets(number))
  )`;

/**
 * The certificate of a completed order, by order id or certificate id, read
 * with `client`: the user's (RLS lets the customer read theirs while the
 * order is completed, and admins all) or, for the print page with a valid
 * token, the admin client. Null when there is none to show.
 */
export async function loadCertificate(
  client: Client,
  by: { orderId: string } | { certificateId: string },
): Promise<CertificateData | null> {
  let query = client.from("certificates").select(SELECT).eq("orders.status", "completed");
  query = "orderId" in by ? query.eq("order_id", by.orderId) : query.eq("id", by.certificateId);
  const [{ data, error }, settings] = await Promise.all([
    query.maybeSingle().overrideTypes<Row, { merge: false }>(),
    client.from("settings").select("company_phone, certificate_text").single(),
  ]);
  if (error) throw new Error(`Certificate read failed: ${error.message}`);
  if (settings.error) throw new Error(`Settings read failed: ${settings.error.message}`);
  if (!data) return null;

  const order = data.orders;
  const media = order.order_media
    .filter((file) => file.kind !== "customer")
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  let urls = new Map<string, string>();
  if (media.length > 0) {
    const { data: signed, error: signError } = await client.storage
      .from("order-media")
      .createSignedUrls(
        media.map((file) => file.path),
        60 * 60,
      );
    if (signError) throw new Error(`Signing failed: ${signError.message}`);
    urls = new Map(
      signed.flatMap((entry) =>
        entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl] as const] : [],
      ),
    );
  }
  const files = (kind: "before" | "after" | "clip") =>
    media
      .filter((file) => file.kind === kind)
      .map((file) => ({
        id: file.id,
        mediaType: file.media_type,
        durationS: file.duration_s,
        url: urls.get(file.path) ?? null,
      }));

  return {
    id: data.id,
    publicCode: data.public_code,
    issuedAt: data.issued_at,
    sterilant: data.sterilant,
    chlorine: data.residual_chlorine_mg_l,
    nextDueOn: data.next_due_on,
    pdfPath: data.pdf_path,
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      serviceDate: order.service_date,
      slotStartAt: order.slot_start_at,
      slotEndAt: order.slot_end_at,
      district: order.district,
      landmark: order.landmark,
      tanks: [...order.order_items]
        .sort((a, b) => a.id - b.id)
        .map(({ tank_type, size, qty }) => ({ tank_type, size, qty })),
    },
    customer: {
      name: order.profiles?.full_name ?? null,
      phone: order.profiles?.phone ?? null,
      remindersEnabled: order.profiles?.reminders_enabled ?? false,
    },
    before: files("before"),
    after: files("after"),
    clips: files("clip"),
    rating: order.ratings
      ? {
          stars: order.ratings.stars,
          tags: order.ratings.tags,
          comment: order.ratings.comment,
          ticketNumber: order.ratings.tickets?.number ?? null,
        }
      : null,
    companyPhone: settings.data.company_phone,
    serviceText: settings.data.certificate_text,
  };
}

/** Report (spec §5.15), as the logged-in customer. */
export async function getCertificate(orderId: string): Promise<CertificateData | null> {
  return loadCertificate(await createClient(), { orderId });
}

export type PublicCertificate = {
  number: number;
  issuedAt: string;
  district: string;
  tanks: CertificateTank[];
};

/** N15: what anyone with the code may see. Null for an unknown code. */
export async function getPublicCertificate(code: string): Promise<PublicCertificate | null> {
  const normalized = normalizePublicCode(code);
  if (!normalized) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("public_certificate", { p_code: normalized })
    .maybeSingle();
  if (error) throw new Error(`Certificate lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    number: data.number,
    issuedAt: data.issued_at,
    district: data.district,
    tanks: (data.items as CertificateTank[] | null) ?? [],
  };
}
