"use client";

import { AlertCircle, Check, CheckCheck, Clock3, ImageOff, LoaderCircle, Play } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { useServerNow } from "@/components/live/use-server-now";
import { Lightbox } from "@/components/ui/lightbox";
import { formatDuration } from "@/lib/booking/media";
import { ticketNumber } from "@/lib/certificates/format";
import {
  type ChatMessage,
  type ChatSide,
  delivery,
  type DayGroup,
  groupByDay,
  isMine,
  messageKey,
  sentAt,
} from "@/lib/chat/messages";
import { cn } from "@/lib/cn";
import { formatDay, formatTime } from "@/lib/dates";

// The conversation (Chat.dc.html, spec §5.16; A4): day chips, then bubbles.
// The viewer's own messages sit on the start side in navy, the other side's
// on the end side in white, as in the canvas. It keeps to the newest message
// unless the reader has scrolled up.

export type ChatLabels = {
  /** Order numbers by id, for tags and system messages. */
  orders: Record<string, { number: number }>;
  /** Ticket numbers by id. */
  tickets: Record<string, number>;
};

export function MessageList({
  messages,
  side,
  labels,
  readAt,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onRetry,
  orderHref,
  actions,
  empty,
  className,
}: {
  messages: ChatMessage[];
  side: ChatSide;
  labels: ChatLabels;
  /** When the page's data was read, by the server's clock (ms). */
  readAt: number;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onRetry: (clientId: string) => void;
  /** Where an order tag links (the admin's A2 drawer, the customer's N4). */
  orderHref?: (orderId: string) => string;
  /** Buttons under a message (Chat's cancel and reschedule). */
  actions?: (message: ChatMessage) => ReactNode;
  /** Shown when there are no messages. */
  empty?: ReactNode;
  className?: string;
}) {
  const t = useTranslations("Chat");
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const last = messages[messages.length - 1];
  const lastKey = last ? messageKey(last) : null;
  // The server's clock, so the day chips render the same on the server and
  // in the browser, and still turn over at midnight.
  const serverNow = useServerNow(readAt, 60_000);
  const groups: DayGroup[] = groupByDay(messages, new Date(serverNow ?? readAt));

  // To the newest message on open and when one arrives, unless the reader
  // is looking at older ones; always after their own.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (pinned.current || (last && isMine(last, side))) element.scrollTop = element.scrollHeight;
  }, [lastKey, last, side]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  };

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3.5", className)}
    >
      {/* Pushes a short conversation to the bottom, as in the canvas. */}
      <div aria-hidden className="flex-1" />
      {hasOlder && (
        <button
          type="button"
          onClick={onLoadOlder}
          disabled={loadingOlder}
          className="mb-2.5 inline-flex min-h-11 items-center justify-center gap-2 self-center px-4 text-14 font-bold text-teal disabled:opacity-60"
        >
          {loadingOlder && <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />}
          {t("older")}
        </button>
      )}
      {messages.length === 0 && empty}
      <ol aria-label={t("messagesLabel")} className="flex flex-col gap-2.5">
        {groups.map((group) => (
          <li key={group.day} className="flex flex-col gap-2.5">
            <span className="self-center rounded-10 bg-border px-2.5 py-0.5 text-12 text-muted">
              {group.label.kind === "date" ? formatDay(group.label.day) : t(group.label.kind)}
            </span>
            <ol className="flex flex-col gap-2.5">
              {group.messages.map((message) => (
                <Bubble
                  key={messageKey(message)}
                  message={message}
                  side={side}
                  labels={labels}
                  onRetry={onRetry}
                  orderHref={orderHref}
                  actions={actions?.(message)}
                />
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A support-side bubble with fixed text, e.g. Chat's welcome. */
export function SupportBubble({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2.5 max-w-4/5 self-end rounded-button rounded-ee-4 border border-border bg-surface px-3 py-2.5 text-15 leading-relaxed text-navy">
      {children}
    </p>
  );
}

function Bubble({
  message,
  side,
  labels,
  onRetry,
  orderHref,
  actions,
}: {
  message: ChatMessage;
  side: ChatSide;
  labels: ChatLabels;
  onRetry: (clientId: string) => void;
  orderHref?: (orderId: string) => string;
  actions?: ReactNode;
}) {
  const t = useTranslations("Chat");
  const mine = isMine(message, side);
  const state = delivery(message);
  const number = message.orderId ? labels.orders[message.orderId]?.number : undefined;
  const num = (chunks: ReactNode) => <span dir="ltr">{chunks}</span>;

  // The words the database doesn't store: topics and system messages.
  let lead: ReactNode = null;
  if (message.kind === "no_show" && number !== undefined) {
    lead = t.rich("system.no_show", { number, num });
  } else if (message.kind === "ticket" && message.ticketId) {
    const ticket = ticketNumber(labels.tickets[message.ticketId] ?? 0);
    lead =
      number !== undefined
        ? t.rich("system.ticket", { ticket, number, num })
        : t.rich("system.ticketNoOrder", { ticket, num });
  } else if (message.topic === "reschedule" || message.topic === "cancel") {
    lead = number !== undefined ? t.rich(`topicText.${message.topic}`, { number, num }) : null;
  } else if (message.topic) {
    lead = t(`topicText.${message.topic}`);
  }

  // An order tag on a message whose words don't already name the order.
  const tag =
    message.orderId &&
    number !== undefined &&
    message.kind === "message" &&
    message.topic !== "reschedule" &&
    message.topic !== "cancel"
      ? t.rich("orderTag", { number, num })
      : null;

  return (
    <li
      className={cn(
        "flex max-w-4/5 flex-col gap-1.5 px-3 py-2.5",
        mine
          ? "self-start rounded-button rounded-es-4 bg-navy text-white"
          : "self-end rounded-button rounded-ee-4 border border-border bg-surface text-navy",
      )}
    >
      {side === "admin" && message.author === "system" && (
        <span className="text-11 font-bold text-muted">{t("auto")}</span>
      )}
      {tag &&
        (message.orderId && orderHref ? (
          <Link
            href={orderHref(message.orderId)}
            className={cn(
              "text-12 font-bold underline-offset-4 hover:underline",
              mine ? "text-aqua" : "text-teal",
            )}
          >
            {tag}
          </Link>
        ) : (
          <span className={cn("text-12 font-bold", mine ? "text-on-dark-muted" : "text-teal")}>
            {tag}
          </span>
        ))}
      {message.mediaType && <Media message={message} />}
      {lead && <span className="text-15 leading-relaxed">{lead}</span>}
      {message.body && (
        <span className="text-15 leading-relaxed break-words whitespace-pre-line">
          {message.body}
        </span>
      )}
      {message.kind === "no_show" && message.orderId && orderHref && (
        <Link
          href={orderHref(message.orderId)}
          className="text-14 font-bold text-teal underline-offset-4 hover:underline"
        >
          {t("actions.details")}
        </Link>
      )}
      {actions}
      <span
        className={cn(
          "flex items-center gap-1.5 text-11",
          mine ? "text-on-dark-muted" : "text-muted",
        )}
      >
        <span>{formatTime(sentAt(message))}</span>
        {mine && <DeliveryIcon state={state} progress={message.progress} />}
      </span>
      {mine && state === "failed" && message.clientId && (
        <button
          type="button"
          onClick={() => onRetry(message.clientId!)}
          className="-my-2 inline-flex min-h-11 items-center gap-1.5 self-start text-13 font-bold text-aqua"
        >
          <AlertCircle aria-hidden className="size-4" />
          {t("retry")}
        </button>
      )}
    </li>
  );
}

function DeliveryIcon({
  state,
  progress,
}: {
  state: ReturnType<typeof delivery>;
  progress: number;
}) {
  const t = useTranslations("Chat.status");
  const label = state === "uploading" ? t("uploading", { progress }) : t(state);
  const Icon =
    state === "read"
      ? CheckCheck
      : state === "sent"
        ? Check
        : state === "failed"
          ? AlertCircle
          : Clock3;
  return (
    <span
      className="inline-flex items-center gap-1"
      role={state === "failed" ? "alert" : undefined}
    >
      <Icon
        aria-hidden
        className={cn("size-3.5", state === "read" && "text-aqua")}
        strokeWidth={2.4}
      />
      {state === "uploading" ? (
        <span dir="ltr">{progress}%</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
      {state === "uploading" && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** A photo (full screen on tap) or a video (plays in place), 200×120 as in the canvas. */
function Media({ message }: { message: ChatMessage }) {
  const t = useTranslations("Chat");
  const [open, setOpen] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  if (!message.url) {
    return (
      <span className="flex h-30 w-50 max-w-full items-center justify-center gap-2 rounded-input bg-navy-2 text-12 text-on-dark-muted">
        <ImageOff aria-hidden className="size-4" />
        {t("fileMissing")}
      </span>
    );
  }

  if (message.mediaType === "photo") {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(0)}
          aria-label={t("openPhoto")}
          className="block overflow-hidden rounded-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        >
          {/* Signed links expire in an hour: a plain img, not next/image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={message.url}
            alt={t("photo")}
            className="max-h-60 w-50 max-w-full object-cover"
          />
        </button>
        <Lightbox
          photos={[{ id: messageKey(message), url: message.url, label: t("photo") }]}
          index={open}
          onIndexChange={setOpen}
        />
      </>
    );
  }

  if (playing) {
    return (
      <video
        src={message.url}
        controls
        autoPlay
        playsInline
        aria-label={t("video")}
        className="h-30 w-50 max-w-full rounded-input bg-navy-2 object-contain"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={t("video")}
      className="relative flex h-30 w-50 max-w-full items-center justify-center rounded-input bg-navy-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aqua"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-white/90">
        <Play aria-hidden className="size-4 fill-navy text-navy" />
      </span>
      {message.durationS !== null && (
        <span dir="ltr" className="absolute end-2 bottom-1.5 text-11 font-bold text-white">
          {formatDuration(message.durationS)}
        </span>
      )}
    </button>
  );
}
