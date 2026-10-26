import { describe, expect, it } from "vitest";

import { chatSendErrorFor } from "@/lib/chat/errors";
import { clockLabel } from "@/lib/chat/hours";
import { chatObjectPath, chatObjectPathPattern } from "@/lib/chat/media";
import {
  type ChatMessage,
  type ChatRow,
  delivery,
  fromRow,
  groupByDay,
  isMine,
  mergeMessages,
  timestampMicros,
  topicNeedsOrder,
  unreadBy,
} from "@/lib/chat/messages";
import { sendChatMessageSchema } from "@/lib/schemas/chat";

// Chat's pure helpers (spec §5.16, A4): ordering, merging live rows with
// messages still sending, read receipts, day chips, hours and input checks.

const THREAD = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";

function row(overrides: Partial<ChatRow>): ChatRow {
  return {
    id: crypto.randomUUID(),
    thread_id: THREAD,
    customer_id: CUSTOMER,
    author: "customer",
    sender_id: CUSTOMER,
    kind: "message",
    body: "مرحبا",
    media_path: null,
    media_type: null,
    duration_s: null,
    bytes: null,
    order_id: null,
    topic: null,
    ticket_id: null,
    client_id: crypto.randomUUID(),
    read_at: null,
    created_at: "2026-10-26T09:00:00.000001+00:00",
    ...overrides,
  };
}

function local(clientId: string, body = "تجربة"): ChatMessage {
  return {
    ...fromRow(row({ id: undefined as unknown as string, client_id: clientId, body })),
    id: null,
    at: Number.POSITIVE_INFINITY,
    state: "sending",
  };
}

describe("timestampMicros", () => {
  it("reads the REST and the Realtime formats alike, to the microsecond", () => {
    const rest = timestampMicros("2026-10-26T09:00:00.123456+00:00");
    expect(timestampMicros("2026-10-26 09:00:00.123456+00")).toBe(rest);
    expect(timestampMicros("2026-10-26T12:00:00.123456+03:00")).toBe(rest);
    expect(timestampMicros("2026-10-26T09:00:00.123457+00:00") - rest).toBe(1);
    expect(timestampMicros("2026-10-26T09:00:00Z")).toBe(Date.UTC(2026, 9, 26, 9) * 1000);
  });
});

describe("mergeMessages", () => {
  it("orders by time, then keeps messages still sending at the end", () => {
    const later = fromRow(row({ created_at: "2026-10-26T09:00:00.000002+00:00", body: "ثانية" }));
    const earlier = fromRow(row({ created_at: "2026-10-26 09:00:00.000001+00", body: "أولى" }));
    const pending = local("c1");
    const merged = mergeMessages([pending], [later, earlier]);
    expect(merged.map((m) => m.body)).toEqual(["أولى", "ثانية", "تجربة"]);
  });

  it("replaces a message still sending with its row, keeping the local file link", () => {
    const pending = { ...local("c2"), url: "blob:local" };
    const server = fromRow(row({ client_id: "c2", body: "تجربة" }));
    const merged = mergeMessages([pending], [server]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: server.id, state: "sent", url: "blob:local" });
  });

  it("updates a row seen again (a read receipt) without duplicating it", () => {
    const first = fromRow(row({}));
    const read = { ...first, readAt: "2026-10-26T09:05:00+00:00" };
    const merged = mergeMessages([first], [read]);
    expect(merged).toHaveLength(1);
    expect(delivery(merged[0]!)).toBe("read");
  });
});

describe("sides and receipts", () => {
  it("puts each side's own messages on the start side", () => {
    const fromCustomer = fromRow(row({}));
    const fromSupport = fromRow(row({ author: "admin" }));
    expect(isMine(fromCustomer, "customer")).toBe(true);
    expect(isMine(fromSupport, "customer")).toBe(false);
    expect(isMine(fromSupport, "admin")).toBe(true);
  });

  it("counts support's and the system's messages as unread for the customer", () => {
    const system = fromRow(
      row({ author: "system", sender_id: null, kind: "auto_reply", client_id: null }),
    );
    expect(unreadBy(system, "customer")).toBe(true);
    expect(unreadBy(system, "admin")).toBe(false);
    expect(unreadBy(fromRow(row({})), "admin")).toBe(true);
    expect(unreadBy({ ...fromRow(row({})), readAt: "2026-10-26T09:01:00Z" }, "admin")).toBe(false);
  });

  it("shows sending, failed, sent and read", () => {
    expect(delivery(local("c3"))).toBe("sending");
    expect(delivery({ ...local("c3"), state: "failed" })).toBe("failed");
    expect(delivery(fromRow(row({})))).toBe("sent");
  });
});

describe("groupByDay", () => {
  it("labels today, yesterday and older days in Baghdad", () => {
    const now = new Date("2026-10-26T10:00:00+03:00");
    const groups = groupByDay(
      [
        fromRow(row({ created_at: "2026-10-24T22:30:00+03:00" })),
        fromRow(row({ created_at: "2026-10-25T23:59:00+03:00" })),
        // 00:30 in Baghdad is still the 26th, though UTC says the 25th.
        fromRow(row({ created_at: "2026-10-25T21:30:00+00:00" })),
        local("c4"),
      ],
      now,
    );
    expect(groups.map((g) => [g.day, g.label.kind, g.messages.length])).toEqual([
      ["2026-10-24", "date", 1],
      ["2026-10-25", "yesterday", 1],
      ["2026-10-26", "today", 2],
    ]);
  });
});

describe("clockLabel", () => {
  it.each([
    ["09:00:00", "9", false],
    ["21:00:00", "9", true],
    ["12:30:00", "12:30", true],
    ["00:00:00", "12", false],
    ["24:00:00", "12", false],
  ])("%s → %s", (time, label, pm) => {
    expect(clockLabel(time)).toEqual({ time: label, pm });
  });
});

describe("sendChatMessageSchema", () => {
  const clientId = crypto.randomUUID();

  it("takes text, a topic or a file", () => {
    expect(sendChatMessageSchema.safeParse({ clientId, body: " هلا " }).data?.body).toBe("هلا");
    expect(sendChatMessageSchema.safeParse({ clientId, topic: "price" }).success).toBe(true);
    const path = chatObjectPath(CUSTOMER, crypto.randomUUID(), "video/mp4");
    expect(chatObjectPathPattern.test(path)).toBe(true);
    expect(
      sendChatMessageSchema.safeParse({ clientId, mediaPath: path, durationS: 15 }).success,
    ).toBe(true);
  });

  it("refuses an empty message, a topic without its order, and a path outside the folder", () => {
    expect(sendChatMessageSchema.safeParse({ clientId, body: "   " }).success).toBe(false);
    expect(sendChatMessageSchema.safeParse({ clientId, topic: "cancel" }).success).toBe(false);
    expect(topicNeedsOrder("reschedule")).toBe(true);
    expect(topicNeedsOrder("complaint")).toBe(false);
    expect(
      sendChatMessageSchema.safeParse({ clientId, mediaPath: `${CUSTOMER}/../x.jpg` }).success,
    ).toBe(false);
    expect(sendChatMessageSchema.safeParse({ clientId, body: "x".repeat(2001) }).success).toBe(
      false,
    );
    expect(
      sendChatMessageSchema.safeParse({
        clientId,
        mediaPath: chatObjectPath(CUSTOMER, clientId, "image/jpeg"),
        durationS: 61,
      }).success,
    ).toBe(false);
  });
});

describe("chatSendErrorFor", () => {
  it("maps the database's codes", () => {
    expect(chatSendErrorFor("ZL027")).toBe("too_many");
    expect(chatSendErrorFor("ZL009")).toBe("upload_missing");
    expect(chatSendErrorFor("P0002")).toBe("failed");
    expect(chatSendErrorFor(undefined)).toBe("failed");
  });
});
