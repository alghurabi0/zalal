import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  cleanUp,
  type CleanupLimits,
  handleRequest,
  SECRET_HEADER,
  serviceKeyFrom,
} from "../../supabase/functions/media-cleanup/cleanup";

// The media-cleanup Edge Function (spec §7 Storage) with a fake Supabase
// client: who may call it, what it accepts, and how it pages through
// unattached_media() and deletes. The real database and Storage are in
// tests/integration/media-cleanup.test.ts.

type Fake = {
  client: SupabaseClient;
  rpcCalls: Array<{ fn: string; args: unknown }>;
  removeCalls: string[][];
};

/**
 * A bucket of files, all unattached. rpc returns the first p_limit names still
 * there; remove deletes the ones that exist, except those in `stuck`.
 */
function fakeClient(names: string[], options: { stuck?: string[]; rpcError?: string } = {}): Fake {
  const files = new Set(names);
  const stuck = new Set(options.stuck ?? []);
  const rpcCalls: Fake["rpcCalls"] = [];
  const removeCalls: Fake["removeCalls"] = [];
  const client = {
    rpc: async (fn: string, args: { p_limit: number }) => {
      rpcCalls.push({ fn, args });
      if (options.rpcError) return { data: null, error: { message: options.rpcError } };
      return { data: [...files].slice(0, args.p_limit), error: null };
    },
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("order-media");
        return {
          remove: async (paths: string[]) => {
            removeCalls.push(paths);
            const removed = paths.filter((path) => files.has(path) && !stuck.has(path));
            for (const path of removed) files.delete(path);
            return { data: removed.map((name) => ({ name })), error: null };
          },
        };
      },
    },
  };
  return { client: client as unknown as SupabaseClient, rpcCalls, removeCalls };
}

const names = (n: number, prefix = "customer/u") =>
  Array.from({ length: n }, (_, i) => `${prefix}/${String(i).padStart(4, "0")}.jpg`);

const small: CleanupLimits = { pageSize: 10, chunkSize: 4, maxPages: 5, budgetMs: 60_000 };

describe("cleanUp", () => {
  it("deletes every unattached file, in chunks, a page at a time", async () => {
    const fake = fakeClient(names(23));
    const result = await cleanUp(fake.client, "customer", small);
    expect(result).toEqual({ folder: "customer", deleted: 23, failed: 0, more: false });
    // Pages of 10, 10, 3; chunks of at most 4.
    expect(fake.rpcCalls).toEqual([
      { fn: "unattached_media", args: { p_folder: "customer", p_limit: 10 } },
      { fn: "unattached_media", args: { p_folder: "customer", p_limit: 10 } },
      { fn: "unattached_media", args: { p_folder: "customer", p_limit: 10 } },
    ]);
    expect(fake.removeCalls.map((chunk) => chunk.length)).toEqual([4, 4, 2, 4, 4, 2, 3]);
  });

  it("does nothing when nothing is unattached", async () => {
    const fake = fakeClient([]);
    expect(await cleanUp(fake.client, "crew", small)).toEqual({
      folder: "crew",
      deleted: 0,
      failed: 0,
      more: false,
    });
    expect(fake.removeCalls).toEqual([]);
  });

  it("stops at maxPages and says there is more", async () => {
    const fake = fakeClient(names(80));
    const result = await cleanUp(fake.client, "customer", { ...small, maxPages: 3 });
    expect(result).toEqual({ folder: "customer", deleted: 30, failed: 0, more: true });
  });

  it("stops starting pages once the time budget is spent", async () => {
    const fake = fakeClient(names(40));
    let clock = 0;
    const result = await cleanUp(fake.client, "customer", { ...small, budgetMs: 1000 }, () => {
      clock += 600;
      return clock;
    });
    // Start at 600 (stop at 1600); page 2 starts at 1200, page 3 at 1800 is refused.
    expect(result).toEqual({ folder: "customer", deleted: 20, failed: 0, more: true });
  });

  it("counts files Storage won't delete and stops when a page deletes none", async () => {
    const all = names(25);
    const stuck = all.slice(0, 10);
    const fake = fakeClient(all, { stuck });
    const result = await cleanUp(fake.client, "customer", small);
    // Page 1 is all stuck files: nothing deleted, so it stops rather than
    // reading the same page again.
    expect(result).toEqual({ folder: "customer", deleted: 0, failed: 10, more: false });
    expect(fake.rpcCalls).toHaveLength(1);
  });

  it("counts a stuck file once, however many pages list it", async () => {
    const all = names(15);
    const fake = fakeClient(all, { stuck: [all[0]!] });
    const result = await cleanUp(fake.client, "customer", small);
    expect(result).toEqual({ folder: "customer", deleted: 14, failed: 1, more: false });
  });

  it("counts a whole chunk as failed when Storage refuses the request", async () => {
    const fake = fakeClient(names(3));
    const refusing = {
      rpc: fake.client.rpc.bind(fake.client),
      storage: {
        from: () => ({ remove: async () => ({ data: null, error: { message: "boom" } }) }),
      },
    } as unknown as SupabaseClient;
    expect(await cleanUp(refusing, "customer", small)).toEqual({
      folder: "customer",
      deleted: 0,
      failed: 3,
      more: false,
    });
  });

  it("throws when unattached_media fails", async () => {
    const fake = fakeClient(names(3), { rpcError: "permission denied" });
    await expect(cleanUp(fake.client, "crew", small)).rejects.toThrow(
      "unattached_media failed: permission denied",
    );
    expect(fake.removeCalls).toEqual([]);
  });
});

describe("handleRequest", () => {
  const env = { secret: "s3cret-value", url: "http://supabase.test", serviceKey: "sb_secret_x" };

  function call(
    init: { method?: string; secret?: string | null; body?: string } = {},
    options: { env?: typeof env; fake?: Fake } = {},
  ) {
    const fake = options.fake ?? fakeClient(names(3));
    const logs: string[] = [];
    const clients: Array<[string, string]> = [];
    const headers = new Headers({ "Content-Type": "application/json" });
    const secret = init.secret === undefined ? env.secret : init.secret;
    if (secret !== null) headers.set(SECRET_HEADER, secret);
    const method = init.method ?? "POST";
    const req = new Request("http://functions.test/media-cleanup", {
      method,
      headers,
      body: method === "POST" ? (init.body ?? JSON.stringify({ folder: "customer" })) : undefined,
    });
    const response = handleRequest(
      req,
      options.env ?? env,
      {
        makeClient: (url, key) => {
          clients.push([url, key]);
          return fake.client;
        },
        log: (line) => logs.push(line),
      },
      small,
    );
    return { response, fake, logs, clients };
  }

  it("cleans the folder with the service key and reports counts", async () => {
    const { response, logs, clients, fake } = call();
    const res = await response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ folder: "customer", deleted: 3, failed: 0, more: false });
    expect(clients).toEqual([["http://supabase.test", "sb_secret_x"]]);
    expect(fake.rpcCalls[0]?.args).toEqual({ p_folder: "customer", p_limit: 10 });
    // Counts only, never a path.
    expect(logs).toEqual([
      JSON.stringify({
        job: "media-cleanup",
        folder: "customer",
        deleted: 3,
        failed: 0,
        more: false,
      }),
    ]);
  });

  it("refuses a missing or wrong secret without touching Storage", async () => {
    for (const secret of [null, "", "wrong", `${env.secret}x`, env.secret.slice(0, -1)]) {
      const { response, clients } = call({ secret });
      expect((await response).status).toBe(401);
      expect(clients).toEqual([]);
    }
  });

  it("refuses anything but POST", async () => {
    const { response, clients } = call({ method: "GET" });
    expect((await response).status).toBe(405);
    expect(clients).toEqual([]);
  });

  it("refuses to run without its secret or keys", async () => {
    for (const missing of ["secret", "url", "serviceKey"] as const) {
      const { response, clients, logs } = call(
        {},
        { env: { ...env, [missing]: undefined } as typeof env },
      );
      const res = await response;
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "not_configured" });
      expect(clients).toEqual([]);
      expect(logs).toHaveLength(1);
    }
  });

  it("refuses a body that isn't one known folder", async () => {
    for (const body of [
      "not json",
      "{}",
      JSON.stringify({ folder: "elsewhere" }),
      JSON.stringify({ folder: "crew", extra: 1 }),
      JSON.stringify(["crew"]),
    ]) {
      const { response, clients } = call({ body });
      const res = await response;
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_body" });
      expect(clients).toEqual([]);
    }
  });

  it("answers 500 and logs the reason when the cleanup fails", async () => {
    const { response, logs } = call({}, { fake: fakeClient([], { rpcError: "db down" }) });
    const res = await response;
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "cleanup_failed" });
    expect(logs).toEqual([
      JSON.stringify({
        job: "media-cleanup",
        folder: "customer",
        error: "unattached_media failed: db down",
      }),
    ]);
  });
});

describe("serviceKeyFrom", () => {
  it("prefers the default new-style secret key", () => {
    expect(serviceKeyFrom('{"default":"sb_secret_new","other":"x"}', "legacy")).toBe(
      "sb_secret_new",
    );
  });

  it("falls back to the legacy service_role key", () => {
    expect(serviceKeyFrom(undefined, "legacy")).toBe("legacy");
    expect(serviceKeyFrom("not json", "legacy")).toBe("legacy");
    expect(serviceKeyFrom('{"other":"x"}', "legacy")).toBe("legacy");
  });

  it("has nothing when neither is set", () => {
    expect(serviceKeyFrom(undefined, undefined)).toBeUndefined();
    expect(serviceKeyFrom("{}", "")).toBeUndefined();
  });
});
