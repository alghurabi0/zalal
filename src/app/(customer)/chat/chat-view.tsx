"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { Composer } from "@/components/chat/composer";
import { MessageList, SupportBubble } from "@/components/chat/message-list";
import { useChat } from "@/components/chat/use-chat";
import { Button } from "@/components/ui/button";
import { ChipButton } from "@/components/ui/chip";
import type { DayOption } from "@/lib/booking/availability";
import {
  CHAT_TOPICS,
  type ChatMessage,
  type ChatTicket,
  type ChatTopic,
  topicNeedsOrder,
} from "@/lib/chat/messages";
import type { ChatOrder } from "@/lib/chat/queries";
import { serviceDayParts, slotParts } from "@/lib/dates";
import { routes } from "@/lib/routes";

import { CancelSheet } from "../orders/[id]/cancel-sheet";
import { RescheduleSheet } from "../orders/[id]/reschedule-sheet";

import { markChatRead, sendChatMessage } from "./actions";
import { OrderPicker } from "./order-picker";

/**
 * Chat's conversation, quick topics and message box (Chat.dc.html, spec
 * §5.16). تغيير موعد and إلغاء طلب open the order picker and send a message
 * tagged with the order; while the 2-hour rule allows, that message carries
 * the N7 / N6 sheet. `?order=` (مساعدة, Tracking, Job progress) tags the
 * next message.
 */
export function ChatView({
  threadId,
  viewerId,
  messages: initial,
  hasOlder,
  orders,
  tickets,
  readAt,
  days,
  tagged,
}: {
  threadId: string;
  viewerId: string;
  messages: ChatMessage[];
  hasOlder: boolean;
  orders: Record<string, ChatOrder>;
  tickets: Record<string, ChatTicket>;
  readAt: number;
  /** N7's days and slots, when a message offers to reschedule. */
  days: DayOption[];
  /** The order `?order=` names. */
  tagged: ChatOrder | null;
}) {
  const t = useTranslations("Chat");
  const router = useRouter();
  const [tag, setTag] = useState(tagged);
  const [picking, setPicking] = useState<ChatTopic | null>(null);

  // A message naming an order or ticket this page hasn't loaded: read again.
  const onMessage = useCallback(
    (message: ChatMessage) => {
      if (
        (message.orderId && !orders[message.orderId]) ||
        (message.ticketId && tickets[message.ticketId] === undefined) ||
        (message.topic === "reschedule" && days.length === 0)
      ) {
        router.refresh();
      }
    },
    [days.length, orders, router, tickets],
  );

  const chat = useChat({
    threadId,
    side: "customer",
    uploaderId: viewerId,
    initial,
    initialHasOlder: hasOlder,
    send: sendChatMessage,
    markRead: markChatRead,
    onMessage,
  });

  const withTag = async (draft: { body?: string; file?: File }) => {
    const sent = await chat.post({ ...draft, ...(tag ? { orderId: tag.id } : {}) });
    if (sent) setTag(null);
    return sent;
  };

  const pickTopic = (topic: ChatTopic) => {
    if (topicNeedsOrder(topic)) setPicking(topic);
    else void chat.post({ topic });
  };

  const changeable = Object.values(orders).filter(
    (order) => order.status === "pending_confirmation" || order.status === "confirmed",
  );

  return (
    <>
      <MessageList
        messages={chat.messages}
        side="customer"
        labels={{ orders, tickets }}
        readAt={readAt}
        hasOlder={chat.hasOlder}
        loadingOlder={chat.loadingOlder}
        onLoadOlder={() => void chat.loadOlder()}
        onRetry={chat.retry}
        orderHref={routes.order}
        actions={(message) => <ChangeActions message={message} orders={orders} days={days} />}
        empty={<SupportBubble>{t("welcome")}</SupportBubble>}
      />

      <div
        role="group"
        aria-label={t("topics.label")}
        className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pt-1 pb-2"
      >
        {CHAT_TOPICS.map((topic) => (
          <ChipButton key={topic} onClick={() => pickTopic(topic)}>
            {t(`topics.${topic}`)}
          </ChipButton>
        ))}
      </div>

      <Composer
        onSend={(body) => withTag({ body })}
        onAttach={(file, caption) => withTag({ file, ...(caption ? { body: caption } : {}) })}
        above={
          <>
            {chat.notice && (
              <p role="alert" className="bg-warn-bg px-4 py-2 text-13 font-bold text-warn-fg">
                {t(`errors.${chat.notice}`)}
              </p>
            )}
            {tag && (
              <div className="flex items-center gap-2 px-4 pt-2">
                <span className="rounded-full bg-selected px-3 py-1 text-13 font-bold text-teal">
                  {t.rich("orderTag", {
                    number: tag.number,
                    num: (chunks) => <span dir="ltr">{chunks}</span>,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => setTag(null)}
                  aria-label={t("removeTag")}
                  className="inline-flex size-11 items-center justify-center rounded-full text-muted"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
            )}
          </>
        }
      />

      <OrderPicker
        topic={picking}
        orders={changeable}
        onClose={() => setPicking(null)}
        onPick={(topic, order) => {
          setPicking(null);
          void chat.post({ topic, orderId: order.id });
        }}
      />
    </>
  );
}

/**
 * Under the customer's own تغيير موعد / إلغاء طلب message: the N7 or N6
 * sheet, while the order can still change (by the server's clock when the
 * page was read; the database checks again).
 */
function ChangeActions({
  message,
  orders,
  days,
}: {
  message: ChatMessage;
  orders: Record<string, ChatOrder>;
  days: DayOption[];
}) {
  const t = useTranslations("Chat.actions");
  const tOrder = useTranslations("Order");
  const tBooking = useTranslations("Booking");
  const order = message.orderId ? orders[message.orderId] : undefined;
  if (
    message.author !== "customer" ||
    !order ||
    order.change !== "allowed" ||
    (message.topic !== "reschedule" && message.topic !== "cancel")
  ) {
    return null;
  }

  const button = (label: string) => (
    <Button size="sm" variant="accent" className="mt-1 h-11 text-14">
      {label}
    </Button>
  );

  if (message.topic === "cancel") {
    return (
      <CancelSheet orderId={order.id} tooLate={false}>
        {button(t("cancel"))}
      </CancelSheet>
    );
  }
  const { weekday, day } = serviceDayParts(order.serviceDate);
  return (
    <RescheduleSheet
      orderId={order.id}
      current={{ serviceDate: order.serviceDate, slotId: order.slotId }}
      currentLabel={tOrder("whenValue", {
        weekday,
        day,
        slot: tBooking("slot", slotParts(order.slotStartAt, order.slotEndAt)),
      })}
      days={days}
      tooLate={false}
    >
      {button(t("reschedule"))}
    </RescheduleSheet>
  );
}
