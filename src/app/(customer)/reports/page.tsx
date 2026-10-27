import { ChevronRight, MessageSquareWarning, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";

import { Screen } from "@/components/layout/screen";
import { LiveTickets } from "@/components/tickets/live-tickets";
import { TicketStatusBadge } from "@/components/tickets/ticket-status-badge";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/auth/viewer";
import { ticketNumber } from "@/lib/certificates/format";
import { formatDate } from "@/lib/dates";
import { routes } from "@/lib/routes";
import { listMyTickets, type MyTicket } from "@/lib/tickets/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Reports");
  return { title: t("metaTitle") };
}

/**
 * My reports (N11, from Profile): the customer's tickets, newest first, with
 * مفتوح / قيد المعالجة / مغلق, live. Each opens its detail; replies come in
 * Chat.
 */
export default async function ReportsPage() {
  const t = await getTranslations("Reports");
  return (
    <Screen className="bg-bg">
      <header className="flex items-center gap-3 px-5 pt-4.5 pb-3.5">
        <BackButton href={routes.profile} />
        <h1 id="reports-title" className="flex-1 text-22 font-black">
          {t("title")}
        </h1>
        <Button href={routes.issue} size="sm" variant="secondary" className="rounded-chip">
          <Plus aria-hidden className="size-4.5" strokeWidth={2.4} />
          {t("new")}
        </Button>
      </header>
      <Suspense fallback={<ReportsSkeleton />}>
        <ReportsContent />
      </Suspense>
    </Screen>
  );
}

async function ReportsContent() {
  const viewer = await requireViewer(routes.reports);
  const t = await getTranslations("Reports");
  const tickets = await listMyTickets();

  return (
    <div className="flex flex-col px-4 pb-6">
      <LiveTickets userId={viewer.id} />
      {tickets.length === 0 ? (
        <EmptyState
          icon={MessageSquareWarning}
          title={t("empty")}
          description={t("emptyBody")}
          action={
            <Button href={routes.issue} size="footer" className="w-full">
              {t("new")}
            </Button>
          }
        />
      ) : (
        <ul aria-labelledby="reports-title" className="flex flex-col gap-2.5">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <TicketCard ticket={ticket} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function TicketCard({ ticket }: { ticket: MyTicket }) {
  const t = await getTranslations("Reports");
  const tIssue = await getTranslations("Issue");
  const num = (chunks: ReactNode) => <span dir="ltr">{chunks}</span>;
  const title = ticket.category
    ? tIssue(`categories.${ticket.category}`)
    : t("fromRating", { stars: ticket.stars ?? 0 });

  return (
    <Card className="relative flex items-center gap-3 p-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={routes.report(ticket.id)}
            className="text-13 text-muted outline-none after:absolute after:inset-0 after:rounded-card focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-teal"
          >
            <span dir="ltr">{ticketNumber(ticket.number)}</span>
            {" · "}
            {formatDate(ticket.createdAt)}
          </Link>
          <TicketStatusBadge status={ticket.status} label={t(`status.${ticket.status}`)} />
        </div>
        <span className="text-16 font-extrabold">{title}</span>
        <span className="text-13 text-muted">
          {ticket.order ? t.rich("order", { number: ticket.order.number, num }) : t("noOrder")}
        </span>
      </div>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-control-off rtl:-scale-x-100" />
    </Card>
  );
}

function ReportsSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-2.5 px-4">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full rounded-card" />
      ))}
    </SkeletonGroup>
  );
}
