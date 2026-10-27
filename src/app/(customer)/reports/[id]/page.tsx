import { MessageCircle, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { z } from "zod";

import { Screen } from "@/components/layout/screen";
import { PhotoGallery } from "@/components/live/photo-gallery";
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
import { getMyTicket, type MyTicketDetails } from "@/lib/tickets/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Reports");
  return { title: t("metaTitle") };
}

/**
 * One of My reports (N11 detail): its status, category or rating, order,
 * the customer's description and files. Replies come in Chat; staff notes
 * never show here.
 */
export default function ReportPage(props: PageProps<"/reports/[id]">) {
  return (
    <Screen className="bg-bg">
      <Suspense fallback={<ReportSkeleton />}>
        <ReportContent {...props} />
      </Suspense>
    </Screen>
  );
}

async function ReportContent({ params }: PageProps<"/reports/[id]">) {
  const { id } = await params;
  const viewer = await requireViewer(routes.report(id));
  const t = await getTranslations("Reports");
  const parsed = z.uuid().safeParse(id);
  const ticket = parsed.success ? await getMyTicket(parsed.data) : null;

  if (!ticket) {
    return (
      <>
        <header className="flex items-center gap-3 px-5 pt-4.5 pb-3.5">
          <BackButton href={routes.reports} />
        </header>
        <EmptyState
          icon={SearchX}
          titleAs="h1"
          title={t("notFound")}
          description={t("notFoundBody")}
          action={
            <Button href={routes.reports} size="footer" className="w-full">
              {t("title")}
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <LiveTickets userId={viewer.id} />
      <header className="flex items-center gap-3 px-5 pt-4.5 pb-3.5">
        <BackButton href={routes.reports} />
        <h1 className="flex-1 text-20 font-black">
          {t.rich("detailTitle", {
            ticket: ticketNumber(ticket.number),
            num: (chunks) => <span dir="ltr">{chunks}</span>,
          })}
        </h1>
        <TicketStatusBadge status={ticket.status} label={t(`status.${ticket.status}`)} />
      </header>
      <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
        <Summary ticket={ticket} />
        {ticket.description && (
          <Card className="flex flex-col gap-1.5 p-3.5">
            <h2 className="text-14 font-extrabold">{t("description")}</h2>
            <p className="text-15 whitespace-pre-line text-body-2">{ticket.description}</p>
          </Card>
        )}
        <Files ticket={ticket} />
      </div>
      <footer className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-border bg-surface px-5 pt-3 pb-safe-5.5">
        <p className="text-center text-13 text-muted">{t("replies")}</p>
        <Button href={routes.chat} size="footer" className="w-full">
          <MessageCircle aria-hidden className="size-5" strokeWidth={2} />
          {t("openChat")}
        </Button>
      </footer>
    </>
  );
}

async function Summary({ ticket }: { ticket: MyTicketDetails }) {
  const t = await getTranslations("Reports");
  const tIssue = await getTranslations("Issue");
  const num = (chunks: ReactNode) => <span dir="ltr">{chunks}</span>;
  return (
    <Card className="flex flex-col gap-1 p-3.5">
      <span className="text-17 font-extrabold">
        {ticket.category
          ? tIssue(`categories.${ticket.category}`)
          : t("fromRating", { stars: ticket.stars ?? 0 })}
      </span>
      <span className="text-14 text-body-2">
        {ticket.order ? t.rich("order", { number: ticket.order.number, num }) : t("noOrder")}
      </span>
      <span className="text-13 text-muted">
        {t("opened", { date: formatDate(ticket.createdAt) })}
        {ticket.updatedAt !== ticket.createdAt && (
          <> · {t("updated", { date: formatDate(ticket.updatedAt) })}</>
        )}
      </span>
      {ticket.order && (
        <Button
          href={routes.order(ticket.order.id)}
          variant="link"
          size="sm"
          className="self-start px-0"
        >
          {t("toOrder")}
        </Button>
      )}
    </Card>
  );
}

async function Files({ ticket }: { ticket: MyTicketDetails }) {
  if (ticket.files.length === 0) return null;
  const t = await getTranslations("Reports");
  const photos = ticket.files.filter((file) => file.kind === "photo");
  const videos = ticket.files.filter((file) => file.kind === "video");
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-14 font-extrabold">{t("files")}</h2>
      {photos.length > 0 && (
        <PhotoGallery
          photos={photos.map((photo, index) => ({
            id: photo.id,
            url: photo.url,
            label: t("file", { kind: "photo", n: index + 1 }),
          }))}
          missing={t("fileMissing")}
        />
      )}
      {videos.length > 0 && (
        <ul className="grid grid-cols-2 gap-2">
          {videos.map((video, index) => (
            <li key={video.id} className="aspect-video overflow-hidden rounded-chip bg-navy">
              {video.url ? (
                <video
                  src={video.url}
                  controls
                  preload="metadata"
                  aria-label={t("file", { kind: "video", n: index + 1 })}
                  className="size-full object-cover"
                />
              ) : (
                <span className="flex size-full items-center justify-center p-1 text-center text-11 text-on-dark-muted">
                  {t("fileMissing")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReportSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-3 px-5 pt-4.5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="h-6 w-40" />
      </div>
      <Skeleton className="h-24 w-full rounded-card" />
      <Skeleton className="h-28 w-full rounded-card" />
    </SkeletonGroup>
  );
}
