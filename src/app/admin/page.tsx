import { ClipboardCheck, Headset, MessagesSquare, Repeat } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { chatInbox, unreadThreadIds } from "@/lib/admin/chat-queries";
import { openTickets, pendingConfirmations, todayCounts } from "@/lib/admin/queries";
import { requireViewer } from "@/lib/auth/viewer";
import { ticketNumber } from "@/lib/certificates/format";
import { baghdadToday, formatDate, formatDayTime } from "@/lib/dates";
import { routes } from "@/lib/routes";

const PENDING_SHOWN = 10;
const TICKETS_SHOWN = 5;
const CHATS_SHOWN = 5;

/**
 * Overview (A1): today's orders by status and the orders waiting for
 * confirmation, kept live by the shell (AdminLive, which follows orders),
 * and the open tickets (for now only those low ratings open, each linking to
 * its order), read when the page loads: tickets aren't in Realtime until A5
 * (Phase 5). Unread chats (A4): their count and the newest few, each
 * opening its conversation. Subscription requests arrive with Phase 6.
 */
export default async function OverviewPage() {
  const t = await getTranslations("Admin.overview");
  return (
    <AdminPage title={t("title")}>
      <Suspense fallback={<OverviewSkeleton />}>
        <Overview />
      </Suspense>
    </AdminPage>
  );
}

async function Overview() {
  await requireViewer(routes.admin, "admin");
  const t = await getTranslations("Admin.overview");
  const tChat = await getTranslations("Admin.chat");
  // The server's clock, in Baghdad.
  const now = new Date();
  const today = baghdadToday(now);
  const [counts, pending, tickets, unreadIds, inbox] = await Promise.all([
    todayCounts(now),
    pendingConfirmations(PENDING_SHOWN),
    openTickets(TICKETS_SHOWN),
    unreadThreadIds(),
    chatInbox(undefined, CHATS_SHOWN),
  ]);
  const unreadChats = inbox.filter((row) => row.admin_unread > 0);
  const todayTotal = ORDER_STATUSES.reduce((sum, status) => sum + counts[status], 0);

  return (
    <>
      <section aria-labelledby="today" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="today" className="text-18 font-extrabold">
            {t("today", { date: formatDate(now), count: todayTotal })}
          </h2>
          <Button
            href={adminOrdersHref({ status: "all", date: today })}
            variant="link"
            size="sm"
            className="px-0"
          >
            {t("todayAll")}
          </Button>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ORDER_STATUSES.map((status) => (
            <li key={status}>
              <Card
                href={adminOrdersHref({ status, date: today })}
                className="flex h-full flex-col items-start gap-2 p-4"
              >
                <StatusBadge status={status} />
                <span className="text-28 font-black" data-testid={`today-${status}`}>
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
        <h2 id="tickets" className="text-18 font-extrabold">
          {t("ticketsOpen", { count: tickets.total })}
        </h2>
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
                  {ticket.order ? (
                    <Link
                      href={routes.adminOrder(ticket.order.id)}
                      className="text-15 font-bold text-teal underline-offset-4 hover:underline"
                    >
                      {t.rich("ticketRow", {
                        ticket: ticketNumber(ticket.number),
                        order: ticket.order.number,
                        num: (chunks) => <span dir="ltr">{chunks}</span>,
                      })}
                    </Link>
                  ) : (
                    <span dir="ltr" className="text-15 font-bold">
                      {ticketNumber(ticket.number)}
                    </span>
                  )}
                  <span className="flex items-center gap-3 text-13 text-muted">
                    {ticket.stars !== null && (
                      <span className="font-bold text-danger">
                        {t("ticketStars", { n: ticket.stars })}
                      </span>
                    )}
                    {formatDayTime(ticket.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section aria-labelledby="later" className="flex flex-col gap-3">
        <h2 id="later" className="text-18 font-extrabold">
          {t("later")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          <Later icon={Repeat} title={t("subscriptions")} />
        </ul>
      </section>
    </>
  );
}

async function Later({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  const t = await getTranslations("Admin.overview");
  return (
    <li>
      <Card className="flex items-center gap-3 p-4 text-muted">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-well">
          <Icon aria-hidden className="size-5" />
        </span>
        <span className="flex flex-col">
          <span className="text-15 font-bold text-navy">{title}</span>
          <span className="text-13">{t("comingSoon")}</span>
        </span>
      </Card>
    </li>
  );
}

function OverviewSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-5">
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
