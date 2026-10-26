import { MessagesSquare, Search, X } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { type InboxRow, chatInbox } from "@/lib/admin/chat-queries";
import { cn } from "@/lib/cn";
import { formatDayTime, formatTime, baghdadToday } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";

import { LiveInbox } from "./live-inbox";

export const INBOX_PAGE = 30;
const INBOX_MAX = 100;

/** `?q=` and `&n=` of the inbox, checked. */
export const inboxQuerySchema = z.object({
  q: z.string().trim().max(60).optional().catch(undefined),
  n: z.coerce.number().int().min(INBOX_PAGE).max(INBOX_MAX).catch(INBOX_PAGE),
});

export type InboxQuery = z.infer<typeof inboxQuerySchema>;

/**
 * A4's thread list (spec §8.2): unread first, then the newest message, with
 * search by name or phone. Live through Realtime.
 */
export async function InboxList({
  query,
  activeId,
  basePath,
}: {
  query: InboxQuery;
  activeId?: string;
  /** Where the search form submits (the page it is on). */
  basePath: string;
}) {
  const t = await getTranslations("Admin.chat");
  const rows = await chatInbox(query.q, query.n + 1);
  const shown = rows.slice(0, query.n);
  const now = new Date();
  const withQuery = (path: string) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.n > INBOX_PAGE) params.set("n", String(query.n));
    const search = params.toString();
    return search ? `${path}?${search}` : path;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <LiveInbox />
      <form action={basePath} className="flex items-center gap-2 border-b border-border p-3">
        <label htmlFor="inbox-search" className="sr-only">
          {t("search")}
        </label>
        <input
          id="inbox-search"
          name="q"
          type="search"
          defaultValue={query.q ?? ""}
          placeholder={t("search")}
          maxLength={60}
          className="h-11 min-w-0 flex-1 rounded-input border border-border bg-bg px-3 text-14 placeholder:text-muted focus-visible:border-teal focus-visible:outline-none"
        />
        <button
          type="submit"
          aria-label={t("searchButton")}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-navy text-aqua"
        >
          <Search aria-hidden className="size-5" />
        </button>
        {query.q && (
          <Link
            href={basePath}
            aria-label={t("clear")}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted"
          >
            <X aria-hidden className="size-5" />
          </Link>
        )}
      </form>

      {shown.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title={query.q ? t("noResults") : t("empty")}
          description={query.q ? undefined : t("emptyBody")}
          className="py-10"
        />
      ) : (
        <nav aria-label={t("listLabel")} className="min-h-0 flex-1 overflow-y-auto">
          <ul className="flex flex-col">
            {shown.map((row) => (
              <li key={row.thread_id}>
                <InboxItem
                  row={row}
                  href={withQuery(routes.adminChatThread(row.thread_id))}
                  active={row.thread_id === activeId}
                  today={baghdadToday(now)}
                />
              </li>
            ))}
          </ul>
          {rows.length > query.n && query.n < INBOX_MAX && (
            <Link
              href={`${basePath}?${new URLSearchParams({
                ...(query.q ? { q: query.q } : {}),
                n: String(Math.min(query.n + INBOX_PAGE, INBOX_MAX)),
              })}`}
              className="flex min-h-11 items-center justify-center text-14 font-bold text-teal"
            >
              {t("more")}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

async function InboxItem({
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
  const t = await getTranslations("Admin.chat");
  const tChat = await getTranslations("Chat");
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

export function InboxListSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-3 p-3">
      <Skeleton className="h-11 rounded-input" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-16 rounded-input" />
      ))}
    </SkeletonGroup>
  );
}
