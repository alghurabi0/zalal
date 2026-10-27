import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { describe, expect, it } from "vitest";

import {
  handleRequest,
  isPushEndpoint,
  type PushEnv,
  type PushRequest,
  SECRET_HEADER,
  sendPush,
} from "../../supabase/functions/send-push/push";

// The send-push Edge Function (spec §9.2) with a fake Supabase client and a
// fake push service: who may call it, which browsers get what, and what
// happens to gone ones. Real encryption and the real database are in
// tests/integration/send-push.test.ts.

const vapidKeys = webpush.generateVAPIDKeys();
const vapid = { subject: "mailto:owner@example.com", ...vapidKeys };

// A real browser key pair, so web-push can encrypt for it.
const browserKeys = {
  p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
  auth: "tBHItJI5svbpez7KI4CCXg",
};

type Row = {
  id: string;
  user_id: string;
  type: string;
  data: Record<string, unknown>;
  order_id: string | null;
  ticket_id: string | null;
};
type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

function fakeClient(rows: Row[], subs: Sub[]) {
  const deleted: string[] = [];
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const client = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      reads.push({ table, filters });
      const query = {
        select: () => query,
        in: (column: string, values: string[]) => {
          filters.push([`in:${column}`, values]);
          return query;
        },
        neq: (column: string, value: string) => {
          filters.push([`neq:${column}`, value]);
          return query;
        },
        delete: () => ({
          in: (_column: string, ids: string[]) => {
            deleted.push(...ids);
            return Promise.resolve({ error: null });
          },
        }),
        then: (resolve: (value: { data: unknown; error: null }) => void) => {
          const ids = filters.find(([name]) => name === "in:id")?.[1] as string[] | undefined;
          const users = filters.find(([name]) => name === "in:user_id")?.[1] as
            string[] | undefined;
          resolve({
            data:
              table === "notifications"
                ? rows.filter((row) => ids?.includes(row.id) && row.type !== "work_started")
                : subs.filter((sub) => users?.includes(sub.user_id)),
            error: null,
          });
        },
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, deleted, reads };
}

const userA = randomUUID();
const userB = randomUUID();
const row = (
  type: string,
  user = userA,
  data: Record<string, unknown> = { number: 1024 },
): Row => ({
  id: randomUUID(),
  user_id: user,
  type,
  data,
  order_id: null,
  ticket_id: null,
});
const sub = (endpoint: string, user = userA): Sub => ({
  id: randomUUID(),
  user_id: user,
  endpoint,
  ...browserKeys,
});

/** A push service that answers by endpoint and records every request. */
function pushService(answers: Record<string, number | "throw"> = {}) {
  const requests: PushRequest[] = [];
  const transport = async (request: PushRequest) => {
    requests.push(request);
    const answer = answers[request.endpoint] ?? 201;
    if (answer === "throw") throw new Error("network");
    return answer;
  };
  return { requests, transport };
}

describe("isPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QGa",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("takes %s", (endpoint) => {
    expect(isPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://example.com/push",
    "https://fcm.googleapis.com.evil.example/push",
    "https://user@fcm.googleapis.com/push",
    "https://fcm.googleapis.com:8443/push",
    "https://127.0.0.1/push",
    "not a url",
  ])("refuses %s", (endpoint) => {
    expect(isPushEndpoint(endpoint)).toBe(false);
  });
});

describe("sendPush", () => {
  it("sends each notification to every browser of its user only", async () => {
    const forA = row("order_confirmed");
    const forB = row("order_confirmed", userB);
    const subs = [
      sub("https://fcm.googleapis.com/fcm/send/a1"),
      sub("https://web.push.apple.com/a2"),
      sub("https://fcm.googleapis.com/fcm/send/b1", userB),
    ];
    const { client } = fakeClient([forA, forB], subs);
    const service = pushService();

    const result = await sendPush(client, [forA.id], vapid, { transport: service.transport });

    expect(result).toEqual({ notifications: 1, sent: 2, failed: 0, removed: 0 });
    expect(service.requests.map((request) => request.endpoint).sort()).toEqual([
      "https://fcm.googleapis.com/fcm/send/a1",
      "https://web.push.apple.com/a2",
    ]);
    const [request] = service.requests;
    expect(request!.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(request!.headers.TTL).toBe("86400");
    expect(request!.headers.Urgency).toBe("high");
    expect(request!.headers.Authorization).toMatch(/^vapid t=/);
    expect(request!.body.byteLength).toBeGreaterThan(0);
  });

  it("never pushes work_started and skips endpoints that aren't push services", async () => {
    const started = row("work_started");
    const arrived = row("crew_arrived");
    const { client, reads } = fakeClient(
      [started, arrived],
      [sub("https://fcm.googleapis.com/fcm/send/a1"), sub("https://example.com/hook")],
    );
    const service = pushService();

    const result = await sendPush(client, [started.id, arrived.id], vapid, {
      transport: service.transport,
    });

    expect(result).toEqual({ notifications: 1, sent: 1, failed: 0, removed: 0 });
    expect(service.requests.map((request) => request.endpoint)).toEqual([
      "https://fcm.googleapis.com/fcm/send/a1",
    ]);
    expect(reads[0]!.filters).toContainEqual(["neq:type", "work_started"]);
  });

  it("deletes browsers that are gone and counts other failures", async () => {
    const notification = row("support_message", userA, { excerpt: "هلا" });
    const subs = [
      sub("https://fcm.googleapis.com/fcm/send/gone"),
      sub("https://fcm.googleapis.com/fcm/send/expired"),
      sub("https://fcm.googleapis.com/fcm/send/busy"),
      sub("https://fcm.googleapis.com/fcm/send/offline"),
    ];
    const { client, deleted } = fakeClient([notification], subs);
    const service = pushService({
      "https://fcm.googleapis.com/fcm/send/gone": 410,
      "https://fcm.googleapis.com/fcm/send/expired": 404,
      "https://fcm.googleapis.com/fcm/send/busy": 429,
      "https://fcm.googleapis.com/fcm/send/offline": "throw",
    });

    const result = await sendPush(client, [notification.id], vapid, {
      transport: service.transport,
    });

    expect(result).toEqual({ notifications: 1, sent: 0, failed: 2, removed: 2 });
    expect(deleted.sort()).toEqual([subs[0]!.id, subs[1]!.id].sort());
  });

  it("collapses chat pushes by topic and sends reminders at normal urgency", async () => {
    const thread = randomUUID();
    const rows = [
      row("support_message", userA, { excerpt: "هلا" }),
      row("customer_message", userA, { excerpt: "هلا", thread_id: thread }),
      row("cleaning_reminder", userA, { kind: "week" }),
    ];
    const { client } = fakeClient(rows, [sub("https://fcm.googleapis.com/fcm/send/a1")]);
    const service = pushService();

    await sendPush(
      client,
      rows.map((r) => r.id),
      vapid,
      { transport: service.transport, concurrency: 1 },
    );

    expect(service.requests.map((request) => request.headers.Topic)).toEqual([
      "chat",
      thread.replaceAll("-", ""),
      undefined,
    ]);
    expect(service.requests[2]!.headers.Urgency).toBe("normal");
  });

  it("does nothing when no row is left", async () => {
    const { client } = fakeClient([], [sub("https://fcm.googleapis.com/fcm/send/a1")]);
    const service = pushService();
    expect(await sendPush(client, [randomUUID()], vapid, { transport: service.transport })).toEqual(
      { notifications: 0, sent: 0, failed: 0, removed: 0 },
    );
    expect(service.requests).toEqual([]);
  });
});

describe("handleRequest", () => {
  const env: PushEnv = {
    secret: "s3cret",
    url: "http://localhost:54321",
    serviceKey: "service",
    vapidPublicKey: vapid.publicKey,
    vapidPrivateKey: vapid.privateKey,
    vapidSubject: vapid.subject,
  };
  const post = (body: unknown, secret = "s3cret") =>
    new Request("http://localhost/functions/v1/send-push", {
      method: "POST",
      headers: { [SECRET_HEADER]: secret },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  function deps(rows: Row[] = [], subs: Sub[] = []) {
    const lines: string[] = [];
    const fake = fakeClient(rows, subs);
    const service = pushService();
    return {
      lines,
      service,
      deps: {
        makeClient: () => fake.client,
        log: (line: string) => lines.push(line),
        send: { transport: service.transport },
      },
    };
  }

  it("takes POST only", async () => {
    const response = await handleRequest(
      new Request("http://localhost/", { method: "GET" }),
      env,
      deps().deps,
    );
    expect(response.status).toBe(405);
  });

  it("refuses a missing or wrong secret, and says nothing when unconfigured", async () => {
    expect(
      (await handleRequest(post({ ids: [randomUUID()] }, "nope"), env, deps().deps)).status,
    ).toBe(401);
    const unconfigured = deps();
    const response = await handleRequest(
      post({ ids: [randomUUID()] }),
      { ...env, secret: undefined },
      unconfigured.deps,
    );
    expect(response.status).toBe(401);
    expect(unconfigured.lines).toEqual([
      JSON.stringify({ job: "send-push", error: "not_configured" }),
    ]);
  });

  it.each([
    ["not json"],
    [{}],
    [{ ids: [] }],
    [{ ids: ["x"] }],
    [{ ids: [randomUUID()], extra: 1 }],
  ])("refuses the body %j", async (body) => {
    expect((await handleRequest(post(body), env, deps().deps)).status).toBe(400);
  });

  it("refuses more than 200 ids", async () => {
    const ids = Array.from({ length: 201 }, () => randomUUID());
    expect((await handleRequest(post({ ids }), env, deps().deps)).status).toBe(400);
  });

  it("answers 503 until the VAPID keys are set", async () => {
    const setup = deps();
    const response = await handleRequest(
      post({ ids: [randomUUID()] }),
      { ...env, vapidPrivateKey: undefined },
      setup.deps,
    );
    expect(response.status).toBe(503);
    expect(setup.service.requests).toEqual([]);
  });

  it("sends and logs counts only", async () => {
    const notification = row("order_completed", userA, { number: 1024 });
    const setup = deps([notification], [sub("https://fcm.googleapis.com/fcm/send/a1")]);
    const response = await handleRequest(post({ ids: [notification.id] }), env, setup.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notifications: 1, sent: 1, failed: 0, removed: 0 });
    expect(setup.lines).toEqual([
      JSON.stringify({ job: "send-push", notifications: 1, sent: 1, failed: 0, removed: 0 }),
    ]);
  });
});
