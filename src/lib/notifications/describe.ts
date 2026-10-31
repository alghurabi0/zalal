import { ticketNumber } from "@/lib/certificates/format";
import type { Database } from "@/lib/database.types";
import { formatDay, formatDayShort, serviceDayParts, slotParts } from "@/lib/dates";
import { routes } from "@/lib/routes";

import type messages from "../../../messages/ar.json";

// What a notification says and where it opens (spec §9.2). The database
// stores the type and the values the words need (migration notifications);
// the words are in ar.json (Notifications.items). The same code renders the
// in-app list (with t.rich) and the push the service worker shows (with
// t.markup), so both always say the same thing. Safe for the browser and
// the service worker: no server imports.

export type NotificationType = Database["public"]["Enums"]["notification_type"];

/** An entry of Notifications.items, each with a title and a body. */
export type NotificationItem = keyof (typeof messages)["Notifications"]["items"];

export type NotificationValues = Record<string, string | number>;

export type Described = { item: NotificationItem; values: NotificationValues };

export type NotificationInput = {
  type: string;
  data: unknown;
  orderId: string | null;
  ticketId: string | null;
};

type WhenValues = {
  weekday: string;
  day: number;
  from: string;
  to: string;
  period: string;
};

/** Notifications.when as plain text; any Notifications translator fits. */
export type WhenTranslator = (key: "when", values: WhenValues) => string;

// Readers for the values the database wrote (migration notifications). Not
// an input boundary, so plain guards rather than Zod: this module is also
// bundled into the service worker, and Zod would multiply its size.
type Data = Record<string, unknown>;

function record(value: unknown): Data | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Data)
    : null;
}
function text(data: Data, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function whole(data: Data, key: string): number | undefined {
  const value = data[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
function oneOf<T extends string>(data: Data, key: string, values: readonly T[]): T | undefined {
  const value = data[key];
  return values.find((option) => option === value);
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const CANCEL_REASONS = ["plans_changed", "time_unsuitable", "other"] as const;
const JOB_CHANGES = ["cancelled", "rescheduled", "reassigned", "removed"] as const;
const MEDIA_TYPES = ["photo", "video"] as const;
const TOPICS = ["reschedule", "cancel", "price", "complaint"] as const;
const TICKET_STATUSES = ["open", "in_progress", "closed"] as const;
const TICKET_CATEGORIES = ["leak", "smell", "late", "staff", "payment", "other"] as const;
const ADDRESS_LABELS = ["home", "family", "work"] as const;

/** A stock quantity, up to 2 decimals in Western digits (as A23 shows it). */
const QUANTITY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const UNKNOWN: Described = { item: "unknown", values: {} };

function orderValues(value: unknown, t: WhenTranslator) {
  const data = record(value);
  if (!data) return null;
  const number = whole(data, "number");
  const day = text(data, "service_date");
  const start = text(data, "slot_start_at");
  const end = text(data, "slot_end_at");
  if (number === undefined || !day || !DAY.test(day) || !start || !end) return null;
  const { weekday, day: dayOfMonth } = serviceDayParts(day);
  const when = t("when", { weekday, day: dayOfMonth, ...slotParts(start, end) });
  return { number, when, district: text(data, "district") ?? "" };
}

/** The ar.json entry and its values for one notification. */
export function describeNotification(
  notification: Pick<NotificationInput, "type" | "data">,
  t: WhenTranslator,
): Described {
  const { type, data } = notification;
  switch (type) {
    case "order_confirmed":
    case "order_rescheduled":
    case "new_booking":
    case "customer_rescheduled":
    case "customer_postponed":
    case "new_job": {
      const order = orderValues(data, t);
      return order ? { item: type, values: order } : UNKNOWN;
    }
    case "order_postponed":
    case "order_cancelled":
    case "crew_on_the_way":
    case "crew_arrived":
    case "work_started":
    case "order_completed":
    case "order_no_show": {
      const order = orderValues(data, t);
      return order ? { item: type, values: { number: order.number } } : UNKNOWN;
    }
    case "customer_cancelled": {
      const order = orderValues(data, t);
      const reason = oneOf(record(data) ?? {}, "cancel_reason", CANCEL_REASONS) ?? "other";
      return order ? { item: type, values: { number: order.number, reason } } : UNKNOWN;
    }
    case "job_changed": {
      const order = orderValues(data, t);
      const change = oneOf(record(data) ?? {}, "change", JOB_CHANGES);
      return order && change ? { item: type, values: { number: order.number, change } } : UNKNOWN;
    }
    case "support_message":
    case "customer_message": {
      const chat = record(data);
      if (!chat) return UNKNOWN;
      const support = type === "support_message";
      const excerpt = text(chat, "excerpt");
      const media = oneOf(chat, "media_type", MEDIA_TYPES);
      const topic = oneOf(chat, "topic", TOPICS);
      if (excerpt) return { item: type, values: { excerpt } };
      if (media) return { item: support ? "support_file" : "customer_file", values: { media } };
      if (topic && !support) return { item: "customer_topic", values: { topic } };
      return UNKNOWN;
    }
    case "ticket_status": {
      const ticket = record(data);
      const number = ticket && whole(ticket, "ticket_number");
      const status = ticket && oneOf(ticket, "status", TICKET_STATUSES);
      return number !== undefined && number !== null && status
        ? { item: type, values: { ticket: ticketNumber(number), status } }
        : UNKNOWN;
    }
    case "new_ticket": {
      const ticket = record(data);
      const raw = ticket && whole(ticket, "ticket_number");
      if (!ticket || raw === undefined || raw === null) return UNKNOWN;
      const number = whole(ticket, "order_number");
      const values = { ticket: ticketNumber(raw) };
      const source = oneOf(ticket, "source", ["app", "rating"] as const);
      const stars = whole(ticket, "stars");
      const category = oneOf(ticket, "category", TICKET_CATEGORIES);
      if (source === "rating" && stars !== undefined && number !== undefined) {
        return { item: "new_ticket_rating", values: { ...values, stars, number } };
      }
      if (source === "app" && category) {
        return number === undefined
          ? { item: "new_ticket_app_no_order", values: { ...values, category } }
          : { item: "new_ticket_app", values: { ...values, category, number } };
      }
      return UNKNOWN;
    }
    case "subscription_requested":
    case "subscription_activated":
    case "subscription_expiring":
    case "subscription_declined": {
      const subscription = record(data);
      if (!subscription) return UNKNOWN;
      const label = oneOf(subscription, "label", ADDRESS_LABELS);
      const district = text(subscription, "district") ?? "";
      const endsOn = text(subscription, "ends_on");
      const visits = whole(subscription, "visits");
      if (!label) return UNKNOWN;
      if (type === "subscription_requested") return { item: type, values: { label, district } };
      if (type === "subscription_declined") return { item: type, values: {} };
      if (!endsOn || !DAY.test(endsOn)) return UNKNOWN;
      const date = formatDay(endsOn);
      if (type === "subscription_expiring") return { item: type, values: { label, date } };
      return visits === undefined ? UNKNOWN : { item: type, values: { label, date, visits } };
    }
    case "stock_low": {
      const stock = record(data);
      if (!stock) return UNKNOWN;
      const name = text(stock, "name");
      const unit = text(stock, "unit");
      const quantity = stock.quantity;
      if (!name || !unit || typeof quantity !== "number") return UNKNOWN;
      return { item: type, values: { name, unit, quantity: QUANTITY.format(quantity) } };
    }
    case "cleaning_reminder": {
      const reminder = record(data);
      if (!reminder) return UNKNOWN;
      const kind = oneOf(reminder, "kind", ["week", "due"] as const);
      const dueOn = text(reminder, "due_on");
      const months = whole(reminder, "months");
      const label = oneOf(reminder, "label", ADDRESS_LABELS);
      if (!kind || !dueOn || !DAY.test(dueOn) || months === undefined || !label) return UNKNOWN;
      return kind === "week"
        ? { item: "reminder_week", values: { label, date: formatDayShort(dueOn) } }
        : { item: "reminder_due", values: { label, months } };
    }
    default:
      return UNKNOWN;
  }
}

/** A uuid the notification's values name (thread_id, subscription_id, address_id). */
function idIn(data: unknown, key: string): string | null {
  const id = text(record(data) ?? {}, key);
  return id && /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

/** The thread an admin's customer_message opens, from its values. */
function threadOf(data: unknown): string | null {
  const thread = text(record(data) ?? {}, "thread_id");
  return thread && /^[0-9a-f-]{36}$/.test(thread) ? thread : null;
}

/**
 * Where tapping a notification goes (spec §9.2 "Opens"). Pages check the
 * order's state again, so an older notification still lands somewhere that
 * makes sense (Tracking sends a finished job on to Job progress, and so on).
 */
export function notificationHref(notification: NotificationInput): string {
  const { type, orderId, ticketId } = notification;
  switch (type) {
    case "order_confirmed":
    case "order_rescheduled":
    case "order_postponed":
    case "order_cancelled":
      return orderId ? routes.order(orderId) : routes.orders;
    case "crew_on_the_way":
      return orderId ? routes.tracking(orderId) : routes.orders;
    case "crew_arrived":
    case "work_started":
      return orderId ? routes.jobProgress(orderId) : routes.orders;
    case "order_completed":
      return orderId ? routes.certificate(orderId) : routes.orders;
    case "order_no_show":
      return orderId ? routes.chatAbout(orderId) : routes.chat;
    case "support_message":
      return routes.chat;
    case "ticket_status":
      return ticketId ? routes.report(ticketId) : routes.reports;
    case "cleaning_reminder":
      return routes.book;
    case "subscription_activated":
    case "subscription_expiring": {
      const address = idIn(notification.data, "address_id");
      return address ? routes.subscriptionFor(address) : routes.subscription;
    }
    case "subscription_declined":
      return routes.chat;
    case "stock_low": {
      const item = idIn(notification.data, "item_id");
      return item ? routes.adminStockItem(item) : routes.adminStock;
    }
    case "subscription_requested": {
      const subscription = idIn(notification.data, "subscription_id");
      return subscription ? routes.adminSubscription(subscription) : routes.adminSubscriptions;
    }
    case "new_booking":
    case "customer_rescheduled":
    case "customer_postponed":
    case "customer_cancelled":
      return orderId ? routes.adminOrder(orderId) : routes.adminOrders;
    case "customer_message": {
      const thread = threadOf(notification.data);
      return thread ? routes.adminChatThread(thread) : routes.adminChat;
    }
    case "new_ticket":
      return ticketId ? routes.adminTicket(ticketId) : routes.adminTickets;
    case "new_job":
      return orderId ? routes.crewJob(orderId) : routes.crew;
    case "job_changed":
      return routes.crew;
    default:
      return routes.notifications;
  }
}
