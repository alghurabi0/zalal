import { Phone } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { LogoMark } from "@/components/brand/logo-mark";
import { Screen } from "@/components/layout/screen";
import { BackButton } from "@/components/ui/back-button";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/auth/viewer";
import { clockLabel } from "@/lib/chat/hours";
import {
  getSupportInfo,
  getThreadContext,
  rescheduleDays,
  type SupportInfo,
} from "@/lib/chat/queries";
import { cn } from "@/lib/cn";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

import { ChatView } from "./chat-view";

/**
 * Chat (Chat.dc.html, spec §5.16): the customer's one thread with support,
 * answered from the admin inbox (A4). The header says when support answers,
 * by working hours. `?order=<id>` (مساعدة on Orders and N4, Tracking, Job
 * progress) tags the next message with that order.
 */
export default function ChatPage(props: PageProps<"/chat">) {
  return (
    <Screen className="h-dvh min-h-0 bg-bg">
      <Suspense fallback={<ChatSkeleton />}>
        <ChatContent {...props} />
      </Suspense>
    </Screen>
  );
}

async function ChatContent({ searchParams }: PageProps<"/chat">) {
  const viewer = await requireViewer(routes.chat);
  const { order } = await searchParams;
  const orderId = z.uuid().safeParse(Array.isArray(order) ? order[0] : order);
  const tagId = orderId.success ? orderId.data : undefined;

  const supabase = await createClient();
  // The server's clock, never the device's: the 2-hour rule and the day chips.
  const now = new Date();
  const [support, thread] = await Promise.all([
    getSupportInfo(supabase),
    supabase.rpc("chat_thread"),
  ]);
  if (thread.error) throw new Error(`chat_thread failed: ${thread.error.message}`);
  const context = await getThreadContext(
    thread.data,
    viewer.id,
    { now, cutoffHours: support.cutoffHours, extraOrderId: tagId },
    supabase,
  );
  const days = await rescheduleDays(context, { now, cutoffHours: support.cutoffHours }, supabase);

  return (
    <>
      <ChatHeader
        support={support}
        back={tagId && context.orders[tagId] ? routes.order(tagId) : routes.home}
      />
      <ChatView
        // A fresh view per thread and tag: Next keeps visited pages alive.
        key={`${thread.data}:${tagId ?? ""}`}
        threadId={thread.data}
        viewerId={viewer.id}
        messages={context.messages}
        hasOlder={context.hasOlder}
        orders={context.orders}
        tickets={context.tickets}
        readAt={now.getTime()}
        days={days}
        tagged={(tagId && context.orders[tagId]) || null}
      />
    </>
  );
}

async function ChatHeader({ support, back }: { support: SupportInfo; back: string }) {
  const t = await getTranslations("Chat");
  const hour = (time: string) => {
    const label = clockLabel(time);
    return t(label.pm ? "pm" : "am", { time: label.time });
  };

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-3.5">
      <BackButton href={back} variant="soft" />
      <span className="flex size-11 shrink-0 items-center justify-center rounded-input bg-navy">
        <LogoMark className="h-5.5 w-6.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="text-16 font-black">{t("title")}</h1>
        <span className={cn("text-12 font-bold", support.open ? "text-ok-fg" : "text-muted")}>
          {support.open
            ? t("open")
            : t("closed", { from: hour(support.hoursStart), to: hour(support.hoursEnd) })}
        </span>
      </div>
      {support.companyPhone && (
        <IconButton
          href={`tel:${support.companyPhone}`}
          label={t("call")}
          icon={Phone}
          variant="soft"
        />
      )}
    </header>
  );
}

function ChatSkeleton() {
  return (
    <SkeletonGroup className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3.5">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="size-11 rounded-input" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-2.5 px-4 py-3.5">
        <Skeleton className="h-16 w-3/5 self-end rounded-button" />
        <Skeleton className="h-20 w-4/5 self-start rounded-button" />
        <Skeleton className="h-16 w-2/3 self-end rounded-button" />
      </div>
      <div className="flex gap-2 border-t border-border bg-surface px-3 pt-2.5 pb-safe-5.5">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="h-11 flex-1 rounded-full" />
        <Skeleton className="size-11 rounded-full" />
      </div>
    </SkeletonGroup>
  );
}
