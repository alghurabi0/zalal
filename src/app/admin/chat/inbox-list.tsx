import { Search, X } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { chatInbox } from "@/lib/admin/chat-queries";

import type { InboxQuery } from "./inbox-query";
import { InboxRows } from "./inbox-rows";

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
  const now = new Date();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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

      <InboxRows
        initial={rows}
        query={query}
        activeId={activeId}
        basePath={basePath}
        readAt={now.getTime()}
      />
    </div>
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
