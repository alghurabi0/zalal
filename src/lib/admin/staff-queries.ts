import "server-only";

import type { Json } from "@/lib/database.types";
import { CURRENT_STATUSES } from "@/lib/orders/status";
import { createClient } from "@/lib/supabase/server";

// Reads for A10 Crews, A14 Admins and the audit log (spec §8.2), made as the
// admin: RLS lets admins read every crew, profile, order and log row. Pages
// call requireViewer(…, "admin") first.

export type AdminCrew = {
  id: string;
  name: string;
  active: boolean;
  phone: string;
  /** Orders from booked to in progress that name this crew. */
  openOrders: number;
};

/** Every crew, active first, with its phone and open orders. */
export async function adminCrews(): Promise<AdminCrew[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crews")
    .select("id, name, active, account:profiles!crews_user_id_fkey(phone)")
    .order("active", { ascending: false })
    .order("name");
  if (error) throw new Error(`Crews read failed: ${error.message}`);

  // One count per crew: a few crews, and counts never meet the row cap.
  const counts = await Promise.all(
    data.map(async (crew) => {
      const { count, error: countError } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("crew_id", crew.id)
        .in("status", CURRENT_STATUSES);
      if (countError) throw new Error(`Crew orders read failed: ${countError.message}`);
      return count ?? 0;
    }),
  );

  return data.map((crew, i) => ({
    id: crew.id,
    name: crew.name,
    active: crew.active,
    phone: crew.account.phone,
    openOrders: counts[i] ?? 0,
  }));
}

export type AdminAccount = { id: string; fullName: string | null; phone: string };

/** Every live admin account, oldest first. */
export async function adminAccounts(): Promise<AdminAccount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone")
    .eq("role", "admin")
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw new Error(`Admins read failed: ${error.message}`);
  return data.map((p) => ({ id: p.id, fullName: p.full_name, phone: p.phone }));
}

/** The log's entities, as the audit filter offers them. */
export const AUDIT_ENTITIES = [
  "orders",
  "price_list",
  "slots",
  "blocked_dates",
  "settings",
  "service_areas",
  "crews",
  "profiles",
  "tickets",
  "articles",
  "article_categories",
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export const AUDIT_PAGE = 50;

export type AuditEntry = {
  id: number;
  action: string;
  entity: string;
  entityId: string;
  diff: Json;
  createdAt: string;
  admin: { fullName: string | null; phone: string };
};

/**
 * One page of the log, newest first, older than `before` (an id). Reads one
 * row past the page to tell whether there is more, so a page never nears
 * PostgREST's 1,000-row cap.
 */
export async function auditLog(filter: {
  entity?: AuditEntity;
  adminId?: string;
  before?: number;
}): Promise<{ entries: AuditEntry[]; nextBefore: number | null }> {
  const supabase = await createClient();
  let query = supabase
    .from("admin_audit_log")
    .select(
      "id, admin_id, action, entity, entity_id, diff, created_at, admin:profiles!admin_audit_log_admin_id_fkey(full_name, phone)",
    )
    .order("id", { ascending: false })
    .limit(AUDIT_PAGE + 1);
  if (filter.entity) query = query.eq("entity", filter.entity);
  if (filter.adminId) query = query.eq("admin_id", filter.adminId);
  if (filter.before) query = query.lt("id", filter.before);
  const { data, error } = await query;
  if (error) throw new Error(`Audit log read failed: ${error.message}`);

  const page = data.slice(0, AUDIT_PAGE);
  return {
    entries: page.map((row) => ({
      id: row.id,
      action: row.action,
      entity: row.entity,
      entityId: row.entity_id,
      diff: row.diff,
      createdAt: row.created_at,
      admin: { fullName: row.admin.full_name, phone: row.admin.phone },
    })),
    nextBefore: data.length > AUDIT_PAGE ? (page.at(-1)?.id ?? null) : null,
  };
}

/** Every admin who has a row in the log, removed ones too, for the filter. */
export async function auditAdmins(): Promise<AdminAccount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, log:admin_audit_log!admin_audit_log_admin_id_fkey!inner(id)")
    .limit(1, { referencedTable: "log" })
    .order("full_name");
  if (error) throw new Error(`Audit admins read failed: ${error.message}`);
  return data.map((p) => ({ id: p.id, fullName: p.full_name, phone: p.phone }));
}

/** Crew ids a log row names: a crew row, or an order's old and new crew. */
function crewIdsIn(entry: AuditEntry): string[] {
  if (entry.entity === "crews") return [entry.entityId];
  if (entry.action !== "order.assign_crew") return [];
  const diff = entry.diff;
  if (typeof diff !== "object" || diff === null || Array.isArray(diff)) return [];
  return [diff.from, diff.to].filter((id): id is string => typeof id === "string");
}

/** Category ids a log row names: the category, or an article's old and new one. */
function categoryIdsIn(entry: AuditEntry): number[] {
  if (entry.entity === "article_categories") {
    const id = Number(entry.entityId);
    return Number.isInteger(id) ? [id] : [];
  }
  const diff = entry.diff;
  if (entry.entity !== "articles" || typeof diff !== "object" || diff === null) return [];
  if (Array.isArray(diff)) return [];
  const category = diff.category_id;
  const values =
    typeof category === "object" && category !== null && !Array.isArray(category)
      ? [category.from, category.to]
      : [category];
  return values.filter((id): id is number => typeof id === "number");
}

/**
 * Order numbers, crew names, article titles and category names the page's
 * rows point at, for links and labels.
 */
export async function auditNames(entries: AuditEntry[]): Promise<{
  orders: Map<string, number>;
  crews: Map<string, string>;
  tickets: Map<string, number>;
  articles: Map<string, string>;
  categories: Map<number, string>;
}> {
  const supabase = await createClient();
  const idsOf = (entity: string) => [
    ...new Set(entries.filter((e) => e.entity === entity).map((e) => e.entityId)),
  ];
  const orderIds = idsOf("orders");
  const ticketIds = idsOf("tickets");
  const crewIds = [...new Set(entries.flatMap(crewIdsIn))];
  const articleIds = idsOf("articles");
  const categoryIds = [...new Set(entries.flatMap(categoryIdsIn))];
  const none = Promise.resolve({ data: [], error: null });
  const [orders, crews, tickets, articles, categories] = await Promise.all([
    orderIds.length ? supabase.from("orders").select("id, number").in("id", orderIds) : none,
    crewIds.length ? supabase.from("crews").select("id, name").in("id", crewIds) : none,
    ticketIds.length ? supabase.from("tickets").select("id, number").in("id", ticketIds) : none,
    articleIds.length ? supabase.from("articles").select("id, title").in("id", articleIds) : none,
    categoryIds.length
      ? supabase.from("article_categories").select("id, name").in("id", categoryIds)
      : none,
  ]);
  if (orders.error) throw new Error(`Audit orders read failed: ${orders.error.message}`);
  if (crews.error) throw new Error(`Audit crews read failed: ${crews.error.message}`);
  if (tickets.error) throw new Error(`Audit tickets read failed: ${tickets.error.message}`);
  if (articles.error) throw new Error(`Audit articles read failed: ${articles.error.message}`);
  if (categories.error) {
    throw new Error(`Audit categories read failed: ${categories.error.message}`);
  }
  return {
    orders: new Map(orders.data.map((o) => [o.id, o.number])),
    crews: new Map(crews.data.map((c) => [c.id, c.name])),
    tickets: new Map(tickets.data.map((ticket) => [ticket.id, ticket.number])),
    articles: new Map(articles.data.map((article) => [article.id, article.title])),
    categories: new Map(categories.data.map((category) => [category.id, category.name])),
  };
}
