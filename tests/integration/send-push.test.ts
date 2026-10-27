import { execFileSync } from "node:child_process";
import {
  createDecipheriv,
  createECDH,
  createHmac,
  randomBytes,
  randomUUID,
  type ECDH,
} from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

import {
  fetchTransport,
  handleRequest,
  SECRET_HEADER,
  type Transport,
} from "../../supabase/functions/send-push/push";

// Web Push (spec §9.2) against the real local database: a signed-in user
// saves this browser over the API (save_push_subscription), a notification
// row is written, and send-push reads it with the service key, encrypts it
// for each browser and posts it. A local HTTP server stands in for the push
// service and the test decrypts what it got (RFC 8291), so the payload is
// checked end to end. A browser the push service says is gone (410) is
// deleted. Which events write rows is pgTAP's (notification_events.test.sql).

const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as { API_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string };

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient<Database>(status.API_URL, status.SECRET_KEY, noSession);

const runId = String(Date.now()).slice(-6);
const userIds: string[] = [];
const vapid = webpush.generateVAPIDKeys();
const SECRET = "integration-push-secret";

type Browser = { ecdh: ECDH; auth: Buffer; p256dh: string; authKey: string };
function browser(): Browser {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    p256dh: ecdh.getPublicKey("base64url"),
    authKey: auth.toString("base64url"),
  };
}

/** RFC 8291 / 8188 aes128gcm, the way a browser opens a push message. */
function decrypt(body: Buffer, to: Browser): string {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const serverKey = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();
  const shared = to.ecdh.computeSecret(serverKey);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    to.ecdh.getPublicKey(),
    serverKey,
    Buffer.from([1]),
  ]);
  const ikm = hmac(hmac(to.auth, shared), keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  // The last record ends with the delimiter 0x02, then padding.
  return plain.subarray(0, plain.lastIndexOf(2)).toString("utf8");
}

let server: Server;
let localEndpoint = "";
const received: Array<{ headers: IncomingHttpHeaders; body: Buffer }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(201).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  localEndpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/push/${randomUUID()}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const id of userIds) await service.auth.admin.deleteUser(id);
});

async function customer(n: number) {
  const phone = `+96478${runId}${String(n).padStart(2, "0")}`;
  const password = randomBytes(32).toString("base64url");
  const { data, error } = await service.auth.admin.createUser({
    phone,
    phone_confirm: true,
    password,
  });
  expect(error).toBeNull();
  userIds.push(data.user!.id);
  const client = createClient<Database>(status.API_URL, status.PUBLISHABLE_KEY, noSession);
  const { error: signInError } = await client.auth.signInWithPassword({ phone, password });
  expect(signInError).toBeNull();
  return { id: data.user!.id, client };
}

function call(ids: string[], transport: Transport) {
  return handleRequest(
    new Request("http://localhost/functions/v1/send-push", {
      method: "POST",
      headers: { [SECRET_HEADER]: SECRET, "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
    {
      secret: SECRET,
      url: status.API_URL,
      serviceKey: status.SECRET_KEY,
      vapidPublicKey: vapid.publicKey,
      vapidPrivateKey: vapid.privateKey,
      vapidSubject: "mailto:owner@example.com",
    },
    // The local server isn't a push service.
    { log: () => {}, send: { transport, allowEndpoint: () => true } },
  );
}

describe("send-push", () => {
  it("delivers each notification to the user's browsers and drops gone ones", async () => {
    const user = await customer(1);
    const phone = browser();
    const gone = browser();
    const goneEndpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;

    // This browser, saved by the signed-in user over the API.
    const { error: saveError } = await user.client.rpc("save_push_subscription", {
      p_endpoint: goneEndpoint,
      p_p256dh: gone.p256dh,
      p_auth: gone.authKey,
      p_user_agent: "Integration",
    });
    expect(saveError).toBeNull();
    // The API doesn't take an http endpoint; the server stands in for one.
    await service
      .from("push_subscriptions")
      .insert({
        user_id: user.id,
        endpoint: localEndpoint,
        p256dh: phone.p256dh,
        auth: phone.authKey,
      })
      .throwOnError();

    const { data: rows } = await service
      .from("notifications")
      .insert([
        { user_id: user.id, type: "crew_on_the_way", data: { number: 1024 } },
        { user_id: user.id, type: "work_started", data: { number: 1024 } },
      ])
      .select("id, type")
      .throwOnError();
    const pushed = rows!.find((row) => row.type === "crew_on_the_way")!;

    // The fcm endpoint answers 410 (gone); the local one is really posted to.
    const transport: Transport = (request) =>
      request.endpoint === goneEndpoint ? Promise.resolve(410) : fetchTransport(request);
    const response = await call(
      rows!.map((row) => row.id),
      transport,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notifications: 1, sent: 1, failed: 0, removed: 1 });

    expect(received).toHaveLength(1);
    const [message] = received;
    expect(message!.headers["content-encoding"]).toBe("aes128gcm");
    expect(message!.headers.urgency).toBe("high");
    expect(message!.headers.authorization).toMatch(/^vapid t=.+, k=/);
    expect(JSON.parse(decrypt(message!.body, phone))).toEqual({
      id: pushed.id,
      type: "crew_on_the_way",
      data: { number: 1024 },
      orderId: null,
      ticketId: null,
    });

    const { data: left } = await service
      .from("push_subscriptions")
      .select("endpoint")
      .eq("user_id", user.id)
      .throwOnError();
    expect(left!.map((row) => row.endpoint)).toEqual([localEndpoint]);
  });

  it("reads and marks notifications over the API as their user only", async () => {
    const owner = await customer(2);
    const other = await customer(3);
    await service
      .from("notifications")
      .insert({ user_id: owner.id, type: "support_message", data: { excerpt: "هلا" } })
      .throwOnError();

    const { data: theirs } = await other.client.from("notifications").select("id");
    expect(theirs).toEqual([]);

    const { data: mine } = await owner.client.from("notifications").select("id, read_at");
    expect(mine).toHaveLength(1);
    expect(mine![0]!.read_at).toBeNull();

    const { error: otherError } = await other.client.rpc("mark_notification_read", {
      p_notification_id: mine![0]!.id,
    });
    expect(otherError?.code).toBe("P0002");

    // Over PostgREST (pg-safeupdate loaded): the RPC's update has its where.
    const { data: count, error } = await owner.client.rpc("mark_all_notifications_read");
    expect(error).toBeNull();
    expect(count).toBe(1);
  });

  it("refuses a caller without the secret", async () => {
    const response = await handleRequest(
      new Request("http://localhost/functions/v1/send-push", {
        method: "POST",
        headers: { [SECRET_HEADER]: "wrong" },
        body: JSON.stringify({ ids: [randomUUID()] }),
      }),
      {
        secret: SECRET,
        url: status.API_URL,
        serviceKey: status.SECRET_KEY,
        vapidPublicKey: vapid.publicKey,
        vapidPrivateKey: vapid.privateKey,
        vapidSubject: "mailto:owner@example.com",
      },
      { log: () => {} },
    );
    expect(response.status).toBe(401);
  });
});
