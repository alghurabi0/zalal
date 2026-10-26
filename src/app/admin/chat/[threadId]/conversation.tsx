"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import { useChat } from "@/components/chat/use-chat";
import type { ChatMessage } from "@/lib/chat/messages";
import { routes } from "@/lib/routes";

import { markAdminChatRead, sendAdminChatMessage } from "../actions";

const CANNED = ["greet", "checking", "rescheduled", "cancelled", "thanks"] as const;

/**
 * A4's conversation (spec §8.2): the customer's messages with their order
 * tags (linking to the A2 drawer, where the admin cancels or reschedules)
 * and files, live; the reply box with canned replies and attachments.
 * Opening it marks the customer's messages read, which shows them ✓✓.
 */
export function AdminConversation({
  threadId,
  viewerId,
  messages,
  hasOlder,
  orders,
  tickets,
  readAt,
}: {
  threadId: string;
  viewerId: string;
  messages: ChatMessage[];
  hasOlder: boolean;
  orders: Record<string, { number: number }>;
  tickets: Record<string, number>;
  readAt: number;
}) {
  const t = useTranslations("Admin.chat");
  const tChat = useTranslations("Chat");
  const router = useRouter();

  const onMessage = useCallback(
    (message: ChatMessage) => {
      if (
        (message.orderId && !orders[message.orderId]) ||
        (message.ticketId && tickets[message.ticketId] === undefined)
      ) {
        router.refresh();
      }
    },
    [orders, router, tickets],
  );

  const chat = useChat({
    threadId,
    side: "admin",
    uploaderId: viewerId,
    initial: messages,
    initialHasOlder: hasOlder,
    send: sendAdminChatMessage,
    markRead: markAdminChatRead,
    onMessage,
  });

  return (
    <>
      <MessageList
        messages={chat.messages}
        side="admin"
        labels={{ orders, tickets }}
        readAt={readAt}
        hasOlder={chat.hasOlder}
        loadingOlder={chat.loadingOlder}
        onLoadOlder={() => void chat.loadOlder()}
        onRetry={chat.retry}
        orderHref={routes.adminOrder}
        className="bg-bg"
      />
      <Composer
        onSend={(body) => chat.post({ body })}
        onAttach={(file, caption) => chat.post({ file, ...(caption ? { body: caption } : {}) })}
        suggestions={{ label: t("canned.label"), items: CANNED.map((key) => t(`canned.${key}`)) }}
        above={
          chat.notice && (
            <p role="alert" className="bg-warn-bg px-4 py-2 text-13 font-bold text-warn-fg">
              {tChat(`errors.${chat.notice}`)}
            </p>
          )
        }
      />
    </>
  );
}
