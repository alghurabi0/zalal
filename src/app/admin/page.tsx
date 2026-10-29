import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Headset,
  MessagesSquare,
  Repeat,
} from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { OrderTable } from "@/components/admin/order-table";
import { StatusBadge } from "@/components/orders/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { adminOrdersHref, ORDER_STATUSES } from "@/lib/admin/orders-query";
import { chatInbox, unreadThreads } from "@/lib/admin/chat-queries";
import {
  type OverviewPeriod,
  overviewHref,
  parseOverviewPeriod,
  periodRange,
  pickerMonth,
  shiftMonth,
} from "@/lib/admin/overview-period";
import { openTickets, orderCounts, pendingConfirmations } from "@/lib/admin/queries";
import { subscriptionRequests } from "@/lib/admin/subscription-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { ticketNumber } from "@/lib/certificates/format";
import { cn } from "@/lib/cn";
import { baghdadToday, formatDate, formatDayTime, formatMonthYear } from "@/lib/dates";
import { routes } from "@/lib/routes";

const PENDING_SHOWN = 10;
const TICKETS_SHOWN = 5;
const CHATS_SHOWN = 5;
const REQUESTS_SHOWN = 5;

/**
 * Overview (A1): the orders of a period by status (from today on by default,
 * today, or a month; `?period=`) and the orders waiting for confirmation, kept live by the shell (AdminLive, which follows orders),
 * and the open tickets (Issue reports and low ratings, each opening the A5
 * drawer; the shell refreshes the page on ticket changes). Unread chats (A4): their count and the newest few, each
 * opening its conversation. Subscription requests (A7): their count and the
 * oldest few, each opening the A7 drawer.
 */
export default async function OverviewPage(props: PageProps<"/admin">) {
  const t = await getTranslations("Admin.overview");
  return (
    <AdminPage title={t("title")}>
      <Suspense fallback={<OverviewSkeleton />}>
        <Overview {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Overview({ searchParams }: PageProps<"/admin">) {
  await requireViewer(routes.admin, "admin");
  const period = parseOverviewPeriod((await searchParams).period);
  const t = await getTranslations("Admin.overview");
  const tChat = await getTranslations("Admin.chat");
  const tIssue = await getTranslations("Issue");
  // The server's clock, in Baghdad.
  const now = new Date();
  const today = baghdadToday(now);
  const tLabels = await getTranslations("Location.labels");
  const range = periodRange(period, today);
  const [counts, pending, tickets, unreadIds, inbox, requests] = await Promise.all([
    orderCounts(range),
    pendingConfirmations(PENDING_SHOWN),
    openTickets(TICKETS_SHOWN),
    unreadThreads(),
    chatInbox(undefined, CHATS_SHOWN),
    subscriptionRequests(REQUESTS_SHOWN),
  ]);
  const unreadChats = inbox.filter((row) => row.admin_unread > 0);
  const total = ORDER_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  // One day keeps A2's day filter; a range uses from/to (open-ended from today on).
  const rangeFilter =
    range.from === range.to
      ? { date: range.from }
      : { from: range.from, to: range.to ?? undefined };
  const heading =
    period.kind === "upcoming"
      ? t("upcoming", { count: total })
      : period.kind === "today"
        ? t("today", { date: formatDate(now), count: total })
        : t(range.from === today ? "monthRest" : "month", {
            month: formatMonthYear(`${period.month}-15T12:00:00Z`),
            count: total,
          });

  return (
    <>
      <section aria-labelledby="orders-period" className="flex flex-col gap-3">
        <PeriodPicker period={period} today={today} />
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="orders-period" className="text-18 font-extrabold">
            {heading}
          </h2>
          <Button
            href={adminOrdersHref({ status: "all", ...rangeFilter })}
            variant="link"
            size="sm"
            className="px-0"
          >
            {t("periodAll")}
          </Button>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ORDER_STATUSES.map((status) => (
            <li key={status}>
              <Card
                href={adminOrdersHref({ status, ...rangeFilter })}
                className="flex h-full flex-col items-start gap-2 p-4"
              >
                <StatusBadge status={status} />
                <span className="text-28 font-black" data-testid={`count-${status}`}>
                  {counts[status]}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="pending" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pending" className="text-18 font-extrabold">
            {t("pending", { count: pending.total })}
          </h2>
          {pending.total > pending.orders.length && (
            <Button
              href={adminOrdersHref({ status: "pending_confirmation" })}
              variant="link"
              size="sm"
              className="px-0"
            >
              {t("pendingAll")}
            </Button>
          )}
        </div>
        {pending.orders.length === 0 ? (
          <Card className="py-6">
            <EmptyState
              icon={ClipboardCheck}
              tone="success"
              title={t("pendingEmpty")}
              description={t("pendingEmptyBody")}
              action={
                <Button href={routes.adminOrders} variant="secondary" size="sm">
                  {t("toOrders")}
                </Button>
              }
            />
          </Card>
        ) : (
          <OrderTable
            orders={pending.orders}
            hrefFor={routes.adminOrder}
            caption={t("pendingCaption")}
          />
        )}
      </section>

      <section aria-labelledby="chats" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="chats" className="text-18 font-extrabold">
            {t("chatsCount", { count: unreadIds.length })}
          </h2>
          <Button href={routes.adminChat} variant="link" size="sm" className="px-0">
            {t("chatsAll")}
          </Button>
        </div>
        {unreadChats.length === 0 ? (
          <Card className="flex items-center gap-3 p-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-well text-muted">
              <MessagesSquare aria-hidden className="size-5" />
            </span>
            <span className="flex flex-col">
              <span className="text-15 font-bold">{t("chatsEmpty")}</span>
              <span className="text-13 text-muted">{t("chatsEmptyBody")}</span>
            </span>
          </Card>
        ) : (
          <Card className="p-0">
            <ul aria-label={t("chatsCaption")} className="flex flex-col">
              {unreadChats.map((row) => (
                <li
                  key={row.thread_id}
                  className="flex items-center justify-between gap-3 border-b border-divider px-4 py-3 last:border-0"
                >
                  <Link
                    href={routes.adminChatThread(row.thread_id)}
                    className="flex min-w-0 flex-col text-15 font-bold text-teal underline-offset-4 hover:underline"
                  >
                    <span className="truncate">{row.full_name || tChat("noName")}</span>
                    <span className="truncate text-13 font-normal text-muted">
                      {row.last_body ?? ""}
                    </span>
                  </Link>
                  <span className="flex shrink-0 items-center gap-3 text-13 text-muted">
                    <span className="font-bold text-navy">
                      {tChat("unread", { count: row.admin_unread })}
                    </span>
                    {row.last_message_at && formatDayTime(row.last_message_at)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section aria-labelledby="tickets" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="tickets" className="text-18 font-extrabold">
            {t("ticketsOpen", { count: tickets.total })}
          </h2>
          <Button href={routes.adminTickets} variant="link" size="sm">
            {t("ticketsAll")}
          </Button>
        </div>
        {tickets.tickets.length === 0 ? (
          <Card className="flex items-center gap-3 p-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-well text-muted">
              <Headset aria-hidden className="size-5" />
            </span>
            <span className="flex flex-col">
              <span className="text-15 font-bold">{t("ticketsEmpty")}</span>
              <span className="text-13 text-muted">{t("ticketsEmptyBody")}</span>
            </span>
          </Card>
        ) : (
          <Card className="p-0">
            <ul aria-label={t("ticketsCaption")} className="flex flex-col">
              {tickets.tickets.map((ticket) => (
                <li
                  key={ticket.id}
                  className="flex items-center justify-between gap-3 border-b border-divider px-4 py-3 last:border-0"
                >
                  <Link
                    href={routes.adminTicket(ticket.id)}
                    className="text-15 font-bold text-teal underline-offset-4 hover:underline"
                  >
                    {ticket.order
                      ? t.rich("ticketRow", {
                          ticket: ticketNumber(ticket.number),
                          order: ticket.order.number,
                          num: (chunks) => <span dir="ltr">{chunks}</span>,
                        })
                      : t.rich("ticketRowNoOrder", {
                          ticket: ticketNumber(ticket.number),
                          num: (chunks) => <span dir="ltr">{chunks}</span>,
                        })}
                  </Link>
                  <span className="flex items-center gap-3 text-13 text-muted">
                    {ticket.stars !== null ? (
                      <span className="font-bold text-danger">
                        {t("ticketStars", { n: ticket.stars })}
                      </span>
                    ) : (
                      ticket.category && (
                        <span className="font-bold text-body-2">
                          {tIssue(`categories.${ticket.category}`)}
                        </span>
                      )
                    )}
                    {formatDayTime(ticket.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section aria-labelledby="subscriptions" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="subscriptions" className="text-18 font-extrabold">
            {t("subscriptions", { count: requests.count })}
          </h2>
          <Button href={routes.adminSubscriptions} variant="link" size="sm">
            {t("subscriptionsAll")}
          </Button>
        </div>
        {requests.oldest.length === 0 ? (
          <Card className="flex items-center gap-3 p-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-well text-muted">
              <Repeat aria-hidden className="size-5" />
            </span>
            <span className="flex flex-col">
              <span className="text-15 font-bold">{t("subscriptionsEmpty")}</span>
              <span className="text-13 text-muted">{t("subscriptionsEmptyBody")}</span>
            </span>
          </Card>
        ) : (
          <Card className="p-0">
            <ul aria-label={t("subscriptionsCaption")} className="flex flex-col">
              {requests.oldest.map((subscription) => (
                <li
                  key={subscription.id}
                  className="flex items-center justify-between gap-3 border-b border-divider px-4 py-3 last:border-0"
                >
                  <Link
                    href={routes.adminSubscription(subscription.id)}
                    className="flex min-w-0 flex-col text-15 font-bold text-teal underline-offset-4 hover:underline"
                  >
                    <span className="truncate">
                      {subscription.customer.name || tChat("noName")}
                    </span>
                    {subscription.address && (
                      <span className="truncate text-13 font-normal text-muted">
                        {t("subscriptionRow", {
                          label: tLabels(subscription.address.label),
                          district: subscription.address.district,
                        })}
                      </span>
                    )}
                  </Link>
                  <span className="shrink-0 text-13 text-muted">
                    {formatDayTime(subscription.requestedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </>
  );
}

/**
 * The period links: from today on, today, and a month with the months
 * before and after it. Previous points to the start, as the page reads.
 */
async function PeriodPicker({ period, today }: { period: OverviewPeriod; today: string }) {
  const t = await getTranslations("Admin.overview");
  const month = pickerMonth(period, today);
  const pill = (on: boolean) =>
    cn(
      "flex min-h-11 items-center rounded-full border-2 px-4 text-14 font-bold",
      on ? "border-navy bg-navy text-white" : "border-border bg-surface text-muted",
    );
  return (
    <nav aria-label={t("periods")} className="flex flex-wrap items-center gap-2">
      <Link
        href={overviewHref({ kind: "upcoming" })}
        aria-current={period.kind === "upcoming" ? "page" : undefined}
        className={pill(period.kind === "upcoming")}
      >
        {t("periodUpcoming")}
      </Link>
      <Link
        href={overviewHref({ kind: "today" })}
        aria-current={period.kind === "today" ? "page" : undefined}
        className={pill(period.kind === "today")}
      >
        {t("periodToday")}
      </Link>
      <span className="flex items-center gap-1">
        <Button
          href={overviewHref(shiftMonth(month, -1))}
          variant="secondary"
          size="sm"
          aria-label={t("prevMonth")}
        >
          <ChevronRight aria-hidden className="size-4" />
        </Button>
        <Link
          href={overviewHref({ kind: "month", month })}
          aria-current={period.kind === "month" ? "page" : undefined}
          className={pill(period.kind === "month")}
        >
          {formatMonthYear(`${month}-15T12:00:00Z`)}
        </Link>
        <Button
          href={overviewHref(shiftMonth(month, 1))}
          variant="secondary"
          size="sm"
          aria-label={t("nextMonth")}
        >
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
      </span>
    </nav>
  );
}

function OverviewSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-5">
      <Skeleton className="h-11 w-96 max-w-full rounded-full" />
      <Skeleton className="h-7 w-64" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ORDER_STATUSES.map((status) => (
          <Skeleton key={status} className="h-24 rounded-card" />
        ))}
      </div>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-48 rounded-card" />
    </SkeletonGroup>
  );
}
