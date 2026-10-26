import { baghdadToday } from "@/lib/dates";
import type { Database } from "@/lib/database.types";

// Chat messages as the screens hold them (spec §5.16, A4): rows from
// chat_messages plus the messages this device is still sending. Pure
// functions, shared by the customer's Chat and the admin inbox.

export type ChatRow = Database["public"]["Tables"]["chat_messages"]["Row"];
export type ChatAuthor = Database["public"]["Enums"]["chat_author"];
export type ChatKind = Database["public"]["Enums"]["chat_message_kind"];
export type ChatTopic = Database["public"]["Enums"]["chat_topic"];
export type ChatSide = "customer" | "admin";

/** The quick topics, in the canvas's order. */
export const CHAT_TOPICS = [
  "reschedule",
  "price",
  "complaint",
  "cancel",
] as const satisfies readonly ChatTopic[];

/** Topics that open the order picker and need an order. */
export function topicNeedsOrder(topic: ChatTopic): boolean {
  return topic === "reschedule" || topic === "cancel";
}

/**
 * A message's state on this device: sending (or uploading its file),
 * failed, or on the server.
 */
export type LocalState = "uploading" | "sending" | "failed" | "sent";

export type ChatMessage = {
  /** Null until the server has the message. */
  id: string | null;
  /** Set on messages people send; matches a local message to its row. */
  clientId: string | null;
  author: ChatAuthor;
  kind: ChatKind;
  body: string | null;
  mediaPath: string | null;
  mediaType: "photo" | "video" | null;
  durationS: number | null;
  orderId: string | null;
  topic: ChatTopic | null;
  ticketId: string | null;
  readAt: string | null;
  /** As the database sent it; "رسائل أقدم" pages from the oldest one. */
  createdAt: string;
  /** created_at in microseconds since 1970, for ordering; Infinity while sending. */
  at: number;
  state: LocalState;
  /** 0–100 while the file uploads. */
  progress: number;
  /** A signed link (an hour), or a local object URL while sending. */
  url: string | null;
};

export function fromRow(row: ChatRow, url: string | null = null): ChatMessage {
  return {
    id: row.id,
    clientId: row.client_id,
    author: row.author,
    kind: row.kind,
    body: row.body,
    mediaPath: row.media_path,
    mediaType: row.media_type,
    durationS: row.duration_s,
    orderId: row.order_id,
    topic: row.topic,
    ticketId: row.ticket_id,
    readAt: row.read_at,
    createdAt: row.created_at,
    at: timestampMicros(row.created_at),
    state: "sent",
    progress: 100,
    url,
  };
}

/** The key a message is listed under: its id, or its client id while sending. */
export function messageKey(message: ChatMessage): string {
  return message.id ?? `local:${message.clientId}`;
}

/**
 * Adds or updates messages. A server row replaces the local message with
 * its client id; a row seen again replaces the old copy (a read receipt),
 * keeping a link already shown. Server rows come in time order; messages
 * still sending stay at the end.
 */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byKey = new Map(current.map((message) => [messageKey(message), message]));
  for (const message of incoming) {
    const local = message.clientId ? byKey.get(`local:${message.clientId}`) : undefined;
    if (local && message.id) byKey.delete(`local:${message.clientId}`);
    const key = messageKey(message);
    const previous = byKey.get(key) ?? local;
    byKey.set(key, { ...message, url: message.url ?? previous?.url ?? null });
  }
  const all = [...byKey.values()];
  const sent = all
    .filter((message) => message.id !== null)
    .sort((a, b) => a.at - b.at || a.id!.localeCompare(b.id!));
  const pending = all.filter((message) => message.id === null);
  return [...sent, ...pending];
}

/** Messages this side sent ("mine") sit on the start side, the rest on the end. */
export function isMine(message: ChatMessage, side: ChatSide): boolean {
  return message.author === side;
}

/** What the ticks under a message of mine say. */
export type Delivery = "uploading" | "sending" | "failed" | "sent" | "read";

export function delivery(message: ChatMessage): Delivery {
  if (message.state !== "sent") return message.state;
  return message.readAt ? "read" : "sent";
}

/** Whether a message from the other side is still unread by `side`. */
export function unreadBy(message: ChatMessage, side: ChatSide): boolean {
  const fromOtherSide =
    side === "customer" ? message.author !== "customer" : message.author === "customer";
  return fromOtherSide && message.id !== null && message.readAt === null;
}

export type DayLabel = { kind: "today" } | { kind: "yesterday" } | { kind: "date"; day: string };

export type DayGroup = { day: string; label: DayLabel; messages: ChatMessage[] };

/**
 * Messages in groups by their day in Baghdad, for the day chips (اليوم,
 * أمس, then the date). Messages still sending count as today.
 */
export function groupByDay(messages: ChatMessage[], now: Date): DayGroup[] {
  const today = baghdadToday(now);
  const yesterday = baghdadToday(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const groups: DayGroup[] = [];
  for (const message of messages) {
    const day = message.id ? baghdadToday(sentAt(message)) : today;
    let group = groups[groups.length - 1];
    if (!group || group.day !== day) {
      const label: DayLabel =
        day === today
          ? { kind: "today" }
          : day === yesterday
            ? { kind: "yesterday" }
            : { kind: "date", day };
      group = { day, label, messages: [] };
      groups.push(group);
    }
    group.messages.push(message);
  }
  return groups;
}

/**
 * A timestamptz as microseconds since 1970. The REST API sends
 * "2026-10-26T18:30:00.123456+00:00" and Realtime may send
 * "2026-10-26 18:30:00.123456+00"; a message and its automatic reply can be
 * less than a millisecond apart, so the microseconds count.
 */
export function timestampMicros(value: string): number {
  const match =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(value);
  if (!match) return Date.parse(value) * 1000;
  let zone = match[4] ?? "Z";
  if (/^[+-]\d{2}$/.test(zone)) zone += ":00";
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const micros = Number((match[3] ?? "").padEnd(6, "0").slice(0, 6));
  return Date.parse(`${match[1]}T${match[2]}${zone}`) * 1000 + micros;
}

/** When a message was sent, as a Date (now while it is still sending). */
export function sentAt(message: ChatMessage): Date {
  return Number.isFinite(message.at) ? new Date(Math.floor(message.at / 1000)) : new Date();
}

/** Messages per page: Chat shows the newest, "رسائل أقدم" loads the page before. */
export const CHAT_PAGE = 50;
