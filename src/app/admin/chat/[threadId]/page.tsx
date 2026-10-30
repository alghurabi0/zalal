import { ChevronLeft, Phone, SearchX } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { CustomerPanel } from "@/components/admin/customer-panel";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { adminThread } from "@/lib/admin/chat-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { getThreadContext } from "@/lib/chat/queries";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

import { first, InboxFrame } from "../inbox-frame";
import { InboxList, InboxListSkeleton } from "../inbox-list";
import { inboxQuerySchema } from "../inbox-query";

import { AdminConversation } from "./conversation";

/**
 * One conversation in the inbox (A4, spec §8.2): the thread list beside it
 * (from 1024px), the messages and reply box, and the customer's orders,
 * addresses, subscription and tickets.
 */
export default function ChatThreadPage(props: PageProps<"/admin/chat/[threadId]">) {
  return (
    <InboxFrame
      listOnSmall={false}
      list={
        <Suspense fallback={<InboxListSkeleton />}>
          <List {...props} />
        </Suspense>
      }
    >
      <Suspense fallback={<ConversationSkeleton />}>
        <Thread {...props} />
      </Suspense>
    </InboxFrame>
  );
}

async function List({ params, searchParams }: PageProps<"/admin/chat/[threadId]">) {
  const { threadId } = await params;
  await requireViewer(routes.adminChatThread(threadId), "admin");
  const search = await searchParams;
  const query = inboxQuerySchema.parse({ q: first(search.q), n: first(search.n) });
  return (
    <InboxList query={query} activeId={threadId} basePath={routes.adminChatThread(threadId)} />
  );
}

async function Thread({ params }: PageProps<"/admin/chat/[threadId]">) {
  const { threadId } = await params;
  const viewer = await requireViewer(routes.adminChatThread(threadId), "admin");
  const t = await getTranslations("Admin.chat");
  const id = z.uuid().safeParse(threadId);
  const thread = id.success ? await adminThread(id.data) : null;

  if (!thread) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={SearchX}
          title={t("notFound")}
          description={t("notFoundBody")}
          action={<Button href={routes.adminChat}>{t("back")}</Button>}
        />
      </div>
    );
  }

  const supabase = await createClient();
  const now = new Date();
  const context = await getThreadContext(thread.id, thread.userId, { now }, supabase);

  return (
    <div className="flex min-w-0 flex-1 flex-col xl:min-h-0 xl:flex-row">
      <section
        aria-labelledby="thread-title"
        className="flex h-dvh min-h-0 min-w-0 flex-1 flex-col xl:h-auto"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-3">
          <Link
            href={routes.adminChat}
            aria-label={t("back")}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-border lg:hidden"
          >
            <ChevronLeft aria-hidden className="size-5 rtl:-scale-x-100" />
          </Link>
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 id="thread-title" className="truncate text-18 font-black">
              {thread.fullName || t("noName")}
            </h2>
            <span dir="ltr" className="self-start text-13 text-muted">
              {formatPhone(thread.phone)}
            </span>
          </div>
          <IconButton href={`tel:${thread.phone}`} label={t("call")} icon={Phone} variant="soft" />
        </header>
        <AdminConversation
          key={thread.id}
          threadId={thread.id}
          viewerId={viewer.id}
          messages={context.messages}
          hasOlder={context.hasOlder}
          orders={context.orders}
          tickets={context.tickets}
          readAt={now.getTime()}
        />
      </section>
      <aside
        aria-labelledby="thread-title"
        className="border-t border-border bg-surface xl:w-80 xl:shrink-0 xl:overflow-y-auto xl:border-s xl:border-t-0"
      >
        <Suspense
          fallback={
            <SkeletonGroup className="p-4">
              <Skeleton className="h-40 rounded-card" />
            </SkeletonGroup>
          }
        >
          <CustomerPanel userId={thread.userId} />
        </Suspense>
      </aside>
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <SkeletonGroup className="flex flex-1 flex-col gap-3 p-4">
      <Skeleton className="h-12 w-48" />
      <Skeleton className="h-16 w-3/5 self-end rounded-button" />
      <Skeleton className="h-16 w-1/2 self-start rounded-button" />
      <Skeleton className="mt-auto h-11 rounded-full" />
    </SkeletonGroup>
  );
}
