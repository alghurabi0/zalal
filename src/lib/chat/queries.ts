import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { bookingDays, type DayOption } from "@/lib/booking/availability";
import type { Database } from "@/lib/database.types";
import { changeState, type OrderStatus } from "@/lib/orders/status";
import { companyPhones } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

import { fetchMessages } from "./load";
import type { ChatMessage, ChatTicket } from "./messages";

// What Chat (spec §5.16) and the A4 conversation read on the server, as the
// logged-in user (RLS decides what they see).

type Client = SupabaseClient<Database>;

/** An order a message is tagged with, or one the topic picker offers. */
export type ChatOrder = {
  id: string;
  number: number;
  status: OrderStatus;
  serviceDate: string;
  slotId: number;
  slotStartAt: string;
  slotEndAt: string;
  /**
   * Cancel and reschedule from Chat: allowed (until the slot starts), too
   * late, postponed (cancel only; support sets the date) or closed.
   */
  change: ReturnType<typeof changeState>;
};

/** Chat's header: support hours (Baghdad) and the company phone. */
export type SupportInfo = {
  open: boolean;
  /** "09:00:00" */
  hoursStart: string;
  hoursEnd: string;
  /** The company phones (companyPhones), none while unset. */
  companyPhones: string[];
  cutoffHours: number;
};

export async function getSupportInfo(client?: Client): Promise<SupportInfo> {
  const supabase = client ?? (await createClient());
  const [{ data: settings, error }, { data: open, error: openError }] = await Promise.all([
    supabase
      .from("settings")
      .select(
        "working_hours_start, working_hours_end, company_phone, company_phone_2, cancel_cutoff_hours",
      )
      .single(),
    supabase.rpc("support_is_open"),
  ]);
  if (error) throw new Error(`Settings read failed: ${error.message}`);
  if (openError) throw new Error(`support_is_open failed: ${openError.message}`);
  return {
    open: open === true,
    hoursStart: settings.working_hours_start,
    hoursEnd: settings.working_hours_end,
    companyPhones: companyPhones(settings),
    cutoffHours: settings.cancel_cutoff_hours,
  };
}

export type ThreadContext = {
  messages: ChatMessage[];
  hasOlder: boolean;
  /** The tagged orders and, for the picker, the customer's pending, confirmed and postponed ones. */
  orders: Record<string, ChatOrder>;
  /** Ticket numbers and sources by id, for ticket messages. */
  tickets: Record<string, ChatTicket>;
};

/**
 * A thread's newest messages with the orders and tickets they name. `now`
 * is the server's clock, for what an order still allows.
 */
export async function getThreadContext(
  threadId: string,
  customerId: string,
  { now, extraOrderId }: { now: Date; extraOrderId?: string },
  client?: Client,
): Promise<ThreadContext> {
  const supabase = client ?? (await createClient());
  const { messages, hasOlder } = await fetchMessages(supabase, threadId);
  const [orders, tickets] = await Promise.all([
    chatOrders(supabase, customerId, messages, { now, extraOrderId }),
    ticketNumbers(supabase, messages),
  ]);
  return { messages, hasOlder, orders, tickets };
}

export async function chatOrders(
  supabase: Client,
  customerId: string,
  messages: ChatMessage[],
  { now, extraOrderId }: { now: Date; extraOrderId?: string },
): Promise<Record<string, ChatOrder>> {
  const ids = [
    ...new Set([
      ...messages.flatMap((message) => (message.orderId ? [message.orderId] : [])),
      ...(extraOrderId ? [extraOrderId] : []),
    ]),
  ];
  const changeable = "status.in.(pending_confirmation,confirmed,postponed)";
  const { data, error } = await supabase
    .from("orders")
    .select("id, number, status, service_date, slot_id, slot_start_at, slot_end_at")
    .eq("customer_id", customerId)
    .or(ids.length > 0 ? `${changeable},id.in.(${ids.join(",")})` : changeable)
    .order("slot_start_at");
  if (error) throw new Error(`Chat orders failed: ${error.message}`);
  return Object.fromEntries(
    data.map((order) => [
      order.id,
      {
        id: order.id,
        number: order.number,
        status: order.status,
        serviceDate: order.service_date,
        slotId: order.slot_id,
        slotStartAt: order.slot_start_at,
        slotEndAt: order.slot_end_at,
        change: changeState(order.status, order.slot_start_at, now),
      },
    ]),
  );
}

async function ticketNumbers(
  supabase: Client,
  messages: ChatMessage[],
): Promise<Record<string, ChatTicket>> {
  const ids = [
    ...new Set(messages.flatMap((message) => (message.ticketId ? [message.ticketId] : []))),
  ];
  if (ids.length === 0) return {};
  const { data, error } = await supabase.from("tickets").select("id, number, source").in("id", ids);
  if (error) throw new Error(`Chat tickets failed: ${error.message}`);
  return Object.fromEntries(
    data.map((ticket) => [ticket.id, { number: ticket.number, source: ticket.source }]),
  );
}

/**
 * The days and slots for rescheduling from Chat (N7's picker), when some
 * message asks to reschedule an order that can still change.
 */
export async function rescheduleDays(
  context: ThreadContext,
  { now, cutoffHours }: { now: Date; cutoffHours: number },
  client?: Client,
): Promise<DayOption[]> {
  const wanted = context.messages.some(
    (message) =>
      message.topic === "reschedule" &&
      message.orderId &&
      context.orders[message.orderId]?.change === "allowed",
  );
  if (!wanted) return [];
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase.rpc("booking_availability");
  if (error) throw new Error(`Availability failed: ${error.message}`);
  return bookingDays(data, now, cutoffHours);
}
