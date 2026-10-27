import { createTranslator } from "next-intl";

import { routes } from "@/lib/routes";

// Only this namespace is bundled into the service worker (a named JSON import).
import { Notifications } from "../../../messages/ar.json";
import { describeNotification } from "./describe";

// What the service worker shows for a push (spec §9.2). send-push sends the
// notification's type and values, not words; this writes them from ar.json
// with the same describeNotification() as the in-app list. A push is plain
// text, so order and ticket numbers are wrapped in Unicode isolates to stay
// left to right inside Arabic. Only the Notifications namespace is bundled.

const t = createTranslator({
  locale: "ar",
  messages: { Notifications },
  namespace: "Notifications",
});

const LRI = "⁦";
const PDI = "⁩";

type Payload = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  orderId: string | null;
  ticketId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOrNull = (value: unknown) =>
  value === null || (typeof value === "string" && UUID.test(value));

/** The payload send-push builds (supabase/functions/send-push/push.ts), or null. */
function readPayload(value: unknown): Payload | null {
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Record<string, unknown>;
  const { id, type, data, orderId, ticketId } = payload;
  if (typeof id !== "string" || !UUID.test(id)) return null;
  if (typeof type !== "string" || type.length === 0) return null;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  if (!idOrNull(orderId) || !idOrNull(ticketId)) return null;
  return {
    id,
    type,
    data: data as Record<string, unknown>,
    orderId: orderId as string | null,
    ticketId: ticketId as string | null,
  };
}

export type PushMessage = {
  title: string;
  body: string;
  /** Replaces an earlier notification with the same tag (chat collapses). */
  tag: string;
  /** Opened on tap: marks it read, then goes to its target. */
  url: string;
};

/** The notification to show for a push payload; a generic one if it can't be read. */
export function pushMessage(payload: unknown): PushMessage {
  const parsed = readPayload(payload);
  const { item, values } = parsed
    ? describeNotification(parsed, t)
    : { item: "unknown" as const, values: {} };
  const num = (chunks: string) => `${LRI}${chunks}${PDI}`;
  return {
    title: t.markup(`items.${item}.title`, { ...values, num }),
    body: t.markup(`items.${item}.body`, { ...values, num }),
    tag: parsed ? tagFor(parsed) : "zalal",
    url: parsed ? routes.openNotification(parsed.id) : routes.home,
  };
}

/** Chat pushes replace each other: the customer's in one, an admin's per conversation. */
function tagFor(payload: Payload): string {
  if (payload.type === "support_message") return "chat";
  const thread = payload.data.thread_id;
  if (payload.type === "customer_message" && typeof thread === "string") return `chat-${thread}`;
  return payload.id;
}
