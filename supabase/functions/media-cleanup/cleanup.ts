import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// The nightly cleanup of uploads nothing uses (spec §7 Storage): order-media
// files no order uses, chat-media files no message sent (migration chat) and
// ticket-media files no ticket attached (migration tickets_app). pg_cron
// posts {"folder": "customer" | "crew" | "chat" | "ticket"} here through pg_net
// (private.invoke_media_cleanup, migration media_cleanup) with the job's
// secret in x-media-cleanup-secret. The rules for what may go live in
// Postgres (public.unattached_media); this only deletes, through the Storage
// API, which also removes the stored file. Plain TypeScript with no Deno
// APIs, so Vitest runs it too; index.ts serves it.

export const SECRET_HEADER = "x-media-cleanup-secret";

export const requestSchema = z
  .object({ folder: z.enum(["customer", "crew", "chat", "ticket"]) })
  .strict();
export type Folder = z.infer<typeof requestSchema>["folder"];

/** The bucket each folder's files are in. */
export const BUCKETS = {
  customer: "order-media",
  crew: "order-media",
  chat: "chat-media",
  ticket: "ticket-media",
} as const satisfies Record<Folder, string>;

const pageSchema = z.array(z.object({ name: z.string().min(1), created_at: z.string().min(1) }));

export type CleanupLimits = {
  /** Names per unattached_media() call (1–1000). */
  pageSize: number;
  /** Names per Storage delete request. */
  chunkSize: number;
  maxPages: number;
  /** Stop starting new pages after this long (ms); pg_net waits 60 s. */
  budgetMs: number;
};

export const DEFAULT_LIMITS: CleanupLimits = {
  pageSize: 500,
  chunkSize: 100,
  maxPages: 10,
  budgetMs: 50_000,
};

export type CleanupResult = {
  folder: Folder;
  deleted: number;
  /** Files Storage didn't delete; they are tried again the next night. */
  failed: number;
  /** Stopped at a limit with files possibly left; the next run goes on. */
  more: boolean;
};

/**
 * Deletes the folder's unattached files, a page at a time, oldest first. Each
 * page starts after the last row of the one before, so files Storage refuses
 * are counted once and don't hold back newer ones. Stops when none are left
 * or a limit is reached.
 */
export async function cleanUp(
  client: SupabaseClient,
  folder: Folder,
  limits: CleanupLimits = DEFAULT_LIMITS,
  now: () => number = Date.now,
): Promise<CleanupResult> {
  const stopAt = now() + limits.budgetMs;
  let deleted = 0;
  let failed = 0;
  let after: { created_at: string; name: string } | null = null;

  for (let page = 0; page < limits.maxPages; page++) {
    if (page > 0 && now() > stopAt) return { folder, deleted, failed, more: true };

    const { data, error } = await client.rpc("unattached_media", {
      p_folder: folder,
      p_limit: limits.pageSize,
      p_after_created_at: after?.created_at ?? null,
      p_after_name: after?.name ?? null,
    });
    if (error) throw new Error(`unattached_media failed: ${error.message}`);
    const rows = pageSchema.parse(data);
    if (rows.length === 0) return { folder, deleted, failed, more: false };

    const names = rows.map((row) => row.name);
    for (let i = 0; i < names.length; i += limits.chunkSize) {
      const chunk = names.slice(i, i + limits.chunkSize);
      const { data: removed, error: removeError } = await client.storage
        .from(BUCKETS[folder])
        .remove(chunk);
      const gone = new Set(removeError ? [] : (removed ?? []).map((file) => file.name));
      const removedNow = chunk.filter((name) => gone.has(name)).length;
      deleted += removedNow;
      failed += chunk.length - removedNow;
    }

    if (rows.length < limits.pageSize) return { folder, deleted, failed, more: false };
    after = rows[rows.length - 1]!;
  }
  return { folder, deleted, failed, more: true };
}

export type CleanupEnv = {
  /** MEDIA_CLEANUP_SECRET, the same value as Vault's media_cleanup_secret. */
  secret: string | undefined;
  /** SUPABASE_URL. */
  url: string | undefined;
  /** The project's secret (service) key. */
  serviceKey: string | undefined;
};

/**
 * Reads the service key the platform gives Edge Functions: the new secret
 * keys (a JSON map, key "default"), or the legacy service_role key.
 */
export function serviceKeyFrom(secretKeys: string | undefined, legacyKey: string | undefined) {
  if (secretKeys) {
    try {
      const parsed = z.record(z.string(), z.string()).safeParse(JSON.parse(secretKeys));
      if (parsed.success && parsed.data.default) return parsed.data.default;
    } catch {
      // Not JSON: fall back to the legacy key.
    }
  }
  return legacyKey || undefined;
}

type Deps = {
  makeClient: (url: string, key: string) => SupabaseClient;
  log: (line: string) => void;
};

const defaultDeps: Deps = {
  makeClient: (url, key) =>
    createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  log: (line) => console.log(line),
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Compares two strings in time that doesn't depend on where they differ. */
async function sameSecret(given: string, expected: string) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all(
    [given, expected].map(
      async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
    ),
  );
  let diff = 0;
  for (let i = 0; i < a!.length; i++) diff |= a![i]! ^ b![i]!;
  return diff === 0;
}

export async function handleRequest(
  req: Request,
  env: CleanupEnv,
  deps: Deps = defaultDeps,
  limits: CleanupLimits = DEFAULT_LIMITS,
): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  // Callers without the secret learn nothing, not even whether it is set.
  if (!env.secret || !env.url || !env.serviceKey) {
    deps.log(JSON.stringify({ job: "media-cleanup", error: "not_configured" }));
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

  try {
    const result = await cleanUp(
      deps.makeClient(env.url, env.serviceKey),
      parsed.data.folder,
      limits,
    );
    // Counts only: paths carry user ids.
    deps.log(JSON.stringify({ job: "media-cleanup", ...result }));
    return json(200, result);
  } catch (error) {
    deps.log(
      JSON.stringify({
        job: "media-cleanup",
        folder: parsed.data.folder,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    return json(500, { error: "cleanup_failed" });
  }
}
