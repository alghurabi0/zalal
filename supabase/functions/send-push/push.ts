import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { z } from "zod";

import { json, sameSecret } from "../_shared/edge.ts";

// The send-push Edge Function (spec §9.2): Web Push for new notifications.
// After each insert on notifications, Postgres posts {"ids": [...]} here
// through pg_net (private.queue_push, migration notifications) with the
// secret in x-send-push-secret. This reads those rows and the users' push
// subscriptions with the service key, sends each browser an encrypted
// payload, and deletes subscriptions the push service says are gone (404,
// 410). The payload carries the type and its values, not words: the service
// worker writes the text from ar.json (src/lib/notifications/push-message.ts).
// Plain TypeScript with no Deno APIs, so Vitest runs it too; index.ts
// serves it.

export const SECRET_HEADER = "x-send-push-secret";

// private.queue_push sends at most 100: the ids go into a GET query string.
export const requestSchema = z.object({ ids: z.array(z.uuid()).min(1).max(100) }).strict();

/** The push services save_push_subscription accepts (the same list). */
const PUSH_HOST =
  /^(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;

export function isPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    PUSH_HOST.test(url.hostname)
  );
}

const notificationSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  order_id: z.uuid().nullable(),
  ticket_id: z.uuid().nullable(),
});
const subscriptionSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  endpoint: z.string().min(1),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});
type NotificationRow = z.infer<typeof notificationSchema>;
type SubscriptionRow = z.infer<typeof subscriptionSchema>;

/** What the service worker receives (src/lib/notifications/push-message.ts reads it). */
export type PushPayload = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  orderId: string | null;
  ticketId: string | null;
};

export type Vapid = { subject: string; publicKey: string; privateKey: string };

export type PushRequest = {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array<ArrayBuffer>;
};

/** Sends one request; returns the HTTP status (0 when it never got one). */
export type Transport = (request: PushRequest) => Promise<number>;

export const fetchTransport: Transport = async (request) => {
  try {
    const response = await fetch(request.endpoint, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    return 0;
  }
};

export type SendOptions = {
  transport?: Transport;
  /** Test servers aren't push services; production keeps the default. */
  allowEndpoint?: (endpoint: string) => boolean;
  /** Requests in flight at once. */
  concurrency?: number;
};

export type SendResult = {
  notifications: number;
  sent: number;
  failed: number;
  /** Subscriptions deleted because the push service said they are gone. */
  removed: number;
};

// A day: an event older than that isn't worth showing.
const TTL_SECONDS = 24 * 60 * 60;

/**
 * Collapses repeated pushes: a newer chat message replaces an older one the
 * phone hasn't received yet (the Topic header, at most 32 URL-safe characters).
 */
function topicFor(row: NotificationRow): string | undefined {
  if (row.type === "support_message") return "chat";
  if (row.type === "customer_message" && typeof row.data.thread_id === "string") {
    return row.data.thread_id.replaceAll("-", "");
  }
  return undefined;
}

export function payloadFor(row: NotificationRow): PushPayload {
  return {
    id: row.id,
    type: row.type,
    data: row.data,
    orderId: row.order_id,
    ticketId: row.ticket_id,
  };
}

/** Builds the encrypted, VAPID-signed request for one browser. */
export function buildRequest(
  row: NotificationRow,
  subscription: Pick<SubscriptionRow, "endpoint" | "p256dh" | "auth">,
  vapid: Vapid,
): PushRequest {
  const topic = topicFor(row);
  const details = webpush.generateRequestDetails(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    JSON.stringify(payloadFor(row)),
    {
      vapidDetails: vapid,
      TTL: TTL_SECONDS,
      urgency: row.type === "cleaning_reminder" ? "normal" : "high",
      ...(topic ? { topic } : {}),
    },
  );
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(details.headers)) headers[name] = String(value);
  return {
    endpoint: details.endpoint,
    method: details.method,
    headers,
    body: Uint8Array.from(details.body ?? []),
  };
}

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(run));
  }
}

/** Sends the notifications to every browser of their users. */
export async function sendPush(
  client: SupabaseClient,
  ids: string[],
  vapid: Vapid,
  options: SendOptions = {},
): Promise<SendResult> {
  const transport = options.transport ?? fetchTransport;
  const allowEndpoint = options.allowEndpoint ?? isPushEndpoint;

  const { data: rowData, error: rowError } = await client
    .from("notifications")
    .select("id, user_id, type, data, order_id, ticket_id")
    .in("id", ids)
    .neq("type", "work_started");
  if (rowError) throw new Error(`notifications read failed: ${rowError.message}`);
  const rows = z.array(notificationSchema).parse(rowData);
  if (rows.length === 0) return { notifications: 0, sent: 0, failed: 0, removed: 0 };

  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const { data: subData, error: subError } = await client
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  if (subError) throw new Error(`push_subscriptions read failed: ${subError.message}`);
  const subscriptions = z.array(subscriptionSchema).parse(subData);

  const jobs = rows.flatMap((row) =>
    subscriptions
      .filter((sub) => sub.user_id === row.user_id && allowEndpoint(sub.endpoint))
      .map((sub) => ({ row, sub })),
  );

  let sent = 0;
  let failed = 0;
  const gone = new Set<string>();
  await inBatches(jobs, options.concurrency ?? 10, async ({ row, sub }) => {
    if (gone.has(sub.id)) return;
    let status = 0;
    try {
      status = await transport(buildRequest(row, sub, vapid));
    } catch {
      status = 0;
    }
    if (status >= 200 && status < 300) sent++;
    else if (status === 404 || status === 410) gone.add(sub.id);
    else failed++;
  });

  if (gone.size > 0) {
    const { error } = await client
      .from("push_subscriptions")
      .delete()
      .in("id", [...gone]);
    if (error) throw new Error(`push_subscriptions delete failed: ${error.message}`);
  }
  return { notifications: rows.length, sent, failed, removed: gone.size };
}

export type PushEnv = {
  /** SEND_PUSH_SECRET, the same value as Vault's send_push_secret. */
  secret: string | undefined;
  /** SUPABASE_URL. */
  url: string | undefined;
  /** The project's secret (service) key. */
  serviceKey: string | undefined;
  vapidPublicKey: string | undefined;
  vapidPrivateKey: string | undefined;
  /** A mailto: or https: contact for the push services. */
  vapidSubject: string | undefined;
};

type Deps = {
  makeClient: (url: string, key: string) => SupabaseClient;
  log: (line: string) => void;
  send: SendOptions;
};

const defaultDeps: Deps = {
  makeClient: (url, key) =>
    createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  log: (line) => console.log(line),
  send: {},
};

export async function handleRequest(
  req: Request,
  env: PushEnv,
  deps: Partial<Deps> = {},
): Promise<Response> {
  const { makeClient, log, send } = { ...defaultDeps, ...deps };
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  // Callers without the secret learn nothing, not even whether it is set.
  if (!env.secret || !env.url || !env.serviceKey) {
    log(JSON.stringify({ job: "send-push", error: "not_configured" }));
    return json(401, { error: "unauthorized" });
  }
  if (!(await sameSecret(req.headers.get(SECRET_HEADER) ?? "", env.secret))) {
    return json(401, { error: "unauthorized" });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_body" });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return json(400, { error: "invalid_body" });

  if (!env.vapidPublicKey || !env.vapidPrivateKey || !env.vapidSubject) {
    // The in-app rows are there; push waits for the owner's keys.
    log(JSON.stringify({ job: "send-push", error: "vapid_not_configured" }));
    return json(503, { error: "vapid_not_configured" });
  }

  try {
    const result = await sendPush(
      makeClient(env.url, env.serviceKey),
      parsed.data.ids,
      {
        subject: env.vapidSubject,
        publicKey: env.vapidPublicKey,
        privateKey: env.vapidPrivateKey,
      },
      send,
    );
    // Counts only: rows carry personal data.
    log(JSON.stringify({ job: "send-push", ...result }));
    return json(200, result);
  } catch (error) {
    log(
      JSON.stringify({
        job: "send-push",
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    return json(500, { error: "push_failed" });
  }
}
