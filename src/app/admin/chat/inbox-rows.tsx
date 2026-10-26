"use client";

import { MessagesSquare } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { useServerNow } from "@/components/live/use-server-now";
import { EmptyState } from "@/components/ui/empty-state";
import type { InboxRow } from "@/lib/admin/chat-queries";
import { cn } from "@/lib/cn";
import { baghdadToday, formatDayTime, formatTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/browser";
import { usePostgresChanges } from "@/lib/supabase/use-postgres-changes";

import { INBOX_MAX, INBOX_PAGE, type InboxQuery, withInboxQuery } from "./inbox-query";

/**
 * The inbox's threads (A4), live: a thread that gets a message or is read
 * makes the list read admin_chat_inbox() again (at most once a second),
 * without refreshing the page, so an open conversation isn't fetched again.
 */
export function InboxRows({
  initial,
  query,
  activeId,
  basePath,
  readAt,
}: {
  /** Up to `query.n + 1` rows; one more than shown says there are more. */
  initial: InboxRow[];
  query: InboxQuery;
  activeId?: string;
  basePath: string;
  /** When the server read them (ms), for "today". */
  readAt: number;
}) {
  const t = useTranslations("Admin.chat");
  const [rows, setRows] = useState(initial);
  // A fresh server read wins (React's pattern for state derived from props).
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setRows(initial);
  }
  const now = useServerNow(readAt, 60_000);
  const today = baghdadToday(new Date(now ?? readAt));

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const reload = () => {
    void createClient()
      .rpc("admin_chat_inbox", { p_search: query.q, p_limit: query.n + 1 })
      .then(({ data }) => {
        if (data) setRows(data);
      });
  };
  usePostgresChanges({
    table: "chat_threads",
    events: ["INSERT", "UPDATE"],
    onChange: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(reload, 1000);
    },
    // A change before the subscription was live.
    onSubscribed: () => reload(),
  });

  const shown = rows.slice(0, query.n);
  if (shown.length === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title={query.q ? t("noResults") : t("empty")}
        description={query.q ? undefined : t("emptyBody")}
        className="py-10"
      />
    );
  }

  return (
    <nav aria-label={t("listLabel")} className="min-h-0 flex-1 overflow-y-auto">
      <ul className="flex flex-col">
        {shown.map((row) => (
          <li key={row.thread_id}>
            <InboxItem
              row={row}
              href={withInboxQuery(routes.adminChatThread(row.thread_id), query)}
              active={row.thread_id === activeId}
              today={today}
            />
          </li>
        ))}
      </ul>
      {rows.length > query.n && query.n < INBOX_MAX && (
        <Link
          href={withInboxQuery(basePath, query, Math.min(query.n + INBOX_PAGE, INBOX_MAX))}
          className="flex min-h-11 items-center justify-center text-14 font-bold text-teal"
        >
          {t("more")}
        </Link>
      )}
    </nav>
  );
}

function InboxItem({
  row,
  href,
  active,
  today,
}: {
  row: InboxRow;
  href: string;
  active: boolean;
  today: string;
}) {
  const t = useTranslations("Admin.chat");
  const tChat = useTranslations("Chat");
  const unread = row.admin_unread > 0;
  const at = row.last_message_at ? new Date(row.last_message_at) : null;

  let preview: string;
  if (row.last_kind && row.last_kind !== "message") preview = t("last.system");
  else if (row.last_body) preview = row.last_body;
  else if (row.last_topic) preview = tChat(`topics.${row.last_topic}`);
  else if (row.last_media_type) preview = t(`last.${row.last_media_type}`);
  else preview = "";

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-18 flex-col gap-0.5 border-b border-divider px-4 py-3 hover:bg-bg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal",
        active && "bg-selected hover:bg-selected",
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className={cn("min-w-0 flex-1 truncate text-15", unread ? "font-black" : "font-bold")}
        >
          {row.full_name || t("noName")}
        </span>
        {at && (
          <span className="shrink-0 text-12 text-muted">
            {baghdadToday(at) === today ? formatTime(at) : formatDayTime(at)}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-13",
            unread ? "font-bold text-navy" : "text-muted",
          )}
        >
          {row.last_author === "admin" && t("you")}
          {preview}
        </span>
        {unread && (
          <span className="flex h-5.5 min-w-5.5 shrink-0 items-center justify-center rounded-full bg-teal px-1.5 text-12 font-extrabold text-white">
            {row.admin_unread}
            <span className="sr-only"> {t("unread", { count: row.admin_unread })}</span>
          </span>
        )}
      </span>
      <span dir="ltr" className="self-end text-12 text-muted">
        {formatPhone(row.phone)}
      </span>
    </Link>
  );
}
