import {
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  Clock,
  House,
  type LucideIcon,
  MessageSquare,
  MessageSquareWarning,
  ShieldCheck,
  Sparkles,
  Truck,
  UserX,
} from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { z } from "zod";

import { CustomerTabBar } from "@/components/chat/customer-tab-bar";
import { Screen } from "@/components/layout/screen";
import { LiveNotifications } from "@/components/notifications/live-notifications";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { addDays, baghdadToday, formatDayShort, formatTime } from "@/lib/dates";
import { describeNotification } from "@/lib/notifications/describe";
import {
  type ListedNotification,
  listNotifications,
  MAX_SHOWN,
  PAGE_SIZE,
} from "@/lib/notifications/queries";
import { routes } from "@/lib/routes";

import { ReadAllButton } from "./read-all-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Notifications");
  return { title: t("metaTitle") };
}

const querySchema = z.object({
  n: z.coerce.number().int().min(PAGE_SIZE).max(MAX_SHOWN).catch(PAGE_SIZE),
});

/**
 * Notifications (Notifications.dc.html, spec §5.7): grouped اليوم / قبل,
 * unread ones on white with a dot. Tapping one goes through
 * /notifications/[id], which marks it read and opens its target; "قراءة الكل"
 * marks them all. Live while open; 30 at a time.
 */
export default function NotificationsPage(props: PageProps<"/notifications">) {
  return (
    <Screen className="bg-bg">
      <div className="flex flex-1 flex-col">
        <Suspense fallback={<NotificationsSkeleton />}>
          <NotificationsContent {...props} />
        </Suspense>
      </div>
      <CustomerTabBar active="home" />
    </Screen>
  );
}

async function NotificationsContent({ searchParams }: PageProps<"/notifications">) {
  const { n } = querySchema.parse({ n: (await searchParams).n });
  // Customers only: staff have no list in v1 (their notifications arrive as push).
  const viewer = await requireViewer(routes.notifications);
  const t = await getTranslations("Notifications");
  const { items, more } = await listNotifications(n);

  const today = baghdadToday();
  const yesterday = addDays(today, -1);
  const groups = [
    { key: "today", title: t("today"), items: [] as ListedNotification[] },
    { key: "earlier", title: t("earlier"), items: [] as ListedNotification[] },
  ];
  for (const item of items) {
    groups[baghdadToday(new Date(item.createdAt)) === today ? 0 : 1]!.items.push(item);
  }
  const timeOf = (createdAt: string) => {
    const day = baghdadToday(new Date(createdAt));
    if (day === today) return formatTime(createdAt);
    if (day === yesterday) return t("yesterday");
    return formatDayShort(day);
  };

  return (
    <>
      <LiveNotifications userId={viewer.id} />
      <header className="flex flex-wrap items-center gap-3 px-5 pt-4.5 pb-3">
        <BackButton href={routes.home} />
        <h1 id="notifications-title" className="flex-1 text-22 font-black">
          {t("title")}
        </h1>
        {items.some((item) => !item.readAt) && <ReadAllButton />}
      </header>
      {items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={t("empty")}
          description={t("emptyBody")}
          action={
            <Button href={routes.book} size="footer" className="w-full">
              {t("emptyAction")}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2 px-4 pb-6">
          {groups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <section
                key={group.key}
                aria-labelledby={`notifications-${group.key}`}
                className="flex flex-col gap-2"
              >
                <h2
                  id={`notifications-${group.key}`}
                  className="px-1 pt-1.5 text-13 font-extrabold text-muted"
                >
                  {group.title}
                </h2>
                <ul className="flex flex-col gap-2">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <NotificationRow item={item} time={timeOf(item.createdAt)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          {more && n < MAX_SHOWN && (
            <Button
              href={`${routes.notifications}?n=${n + PAGE_SIZE}`}
              variant="secondary"
              size="sm"
              scroll={false}
              replace
              className="self-center"
            >
              {t("more")}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

type Tone = "info" | "warn" | "ok" | "neutral";

const toneClasses: Record<Tone, string> = {
  info: "bg-selected text-teal",
  warn: "bg-warn-bg text-warn-icon",
  ok: "bg-ok-bg text-ok-fg",
  neutral: "bg-well text-muted",
};

/** The canvas's icon tiles, and the same family for the events it doesn't draw. */
const icons: Record<string, { icon: LucideIcon; tone: Tone }> = {
  order_confirmed: { icon: CalendarCheck, tone: "info" },
  order_rescheduled: { icon: CalendarClock, tone: "info" },
  order_postponed: { icon: CalendarClock, tone: "warn" },
  order_cancelled: { icon: CalendarX, tone: "neutral" },
  crew_on_the_way: { icon: Truck, tone: "warn" },
  crew_arrived: { icon: House, tone: "warn" },
  work_started: { icon: Sparkles, tone: "info" },
  order_completed: { icon: ShieldCheck, tone: "ok" },
  order_no_show: { icon: UserX, tone: "warn" },
  support_message: { icon: MessageSquare, tone: "info" },
  ticket_status: { icon: MessageSquareWarning, tone: "info" },
  cleaning_reminder: { icon: Clock, tone: "neutral" },
};

async function NotificationRow({ item, time }: { item: ListedNotification; time: string }) {
  const t = await getTranslations("Notifications");
  const { item: entry, values } = describeNotification(item, t);
  const num = (chunks: ReactNode) => <bdi dir="ltr">{chunks}</bdi>;
  const { icon: Icon, tone } = icons[item.type] ?? { icon: Bell, tone: "neutral" };
  const unread = !item.readAt;

  return (
    // A full page load: the route marks the notification read on the
    // server, then redirects to its target.
    <a
      href={routes.openNotification(item.id)}
      className={cn(
        "flex items-start gap-3 rounded-button border p-3 text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
        unread ? "border-chip-border bg-surface" : "border-transparent",
      )}
    >
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-input",
          toneClasses[tone],
        )}
      >
        <Icon aria-hidden className="size-5.5" strokeWidth={2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-15 font-extrabold">
          {t.rich(`items.${entry}.title`, { ...values, num })}
        </span>
        <span className="text-13 leading-relaxed break-words text-muted">
          {t.rich(`items.${entry}.body`, { ...values, num })}
        </span>
        <span className="text-12 text-muted">{time}</span>
      </span>
      {unread && (
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-teal">
          <span className="sr-only">{t("unread")}</span>
        </span>
      )}
    </a>
  );
}

function NotificationsSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-2 px-4 pt-4.5">
      <div className="flex items-center gap-3 px-1 pb-3">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="h-7 w-32" />
      </div>
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full rounded-button" />
      ))}
    </SkeletonGroup>
  );
}
