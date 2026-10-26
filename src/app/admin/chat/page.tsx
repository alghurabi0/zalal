import { MessagesSquare } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";

import { first, InboxFrame } from "./inbox-frame";
import { InboxList, InboxListSkeleton } from "./inbox-list";
import { inboxQuerySchema } from "./inbox-query";

/**
 * Chat inbox (A4, spec §8.2): every customer thread, unread first. Opening
 * one shows the conversation and the customer's panel.
 */
export default async function ChatInboxPage(props: PageProps<"/admin/chat">) {
  const t = await getTranslations("Admin.chat");
  return (
    <InboxFrame
      listOnSmall
      list={
        <Suspense fallback={<InboxListSkeleton />}>
          <List {...props} />
        </Suspense>
      }
    >
      <div className="hidden flex-1 items-center justify-center lg:flex">
        <EmptyState icon={MessagesSquare} title={t("pick")} description={t("pickBody")} />
      </div>
    </InboxFrame>
  );
}

async function List({ searchParams }: PageProps<"/admin/chat">) {
  await requireViewer(routes.adminChat, "admin");
  const params = await searchParams;
  const query = inboxQuerySchema.parse({ q: first(params.q), n: first(params.n) });
  return <InboxList query={query} basePath={routes.adminChat} />;
}
