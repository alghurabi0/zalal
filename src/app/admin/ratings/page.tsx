import { SearchX, Star } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { TicketStatusBadge } from "@/components/tickets/ticket-status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { type AdminRatingRow, listAdminRatings, ratingSummary } from "@/lib/admin/ticket-queries";
import {
  ADMIN_LIST_PAGE,
  adminRatingsHref,
  parseAdminRatingsQuery,
  ratingAverage,
} from "@/lib/admin/tickets-query";
import { requireViewer } from "@/lib/auth/viewer";
import { ticketNumber } from "@/lib/certificates/format";
import { cn } from "@/lib/cn";
import { formatDayTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";

/**
 * Ratings (A12, spec §8.2): the average and the count per star, a star
 * filter (`?stars=`), and every rating newest first with a link to its
 * order and to any ticket it opened (3 stars or fewer).
 */
export default async function AdminRatingsPage(props: PageProps<"/admin/ratings">) {
  const t = await getTranslations("Admin.ratings");
  return (
    <AdminPage title={t("title")}>
      <Suspense fallback={<RatingsSkeleton />}>
        <Ratings {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Ratings({ searchParams }: PageProps<"/admin/ratings">) {
  await requireViewer(routes.adminRatings, "admin");
  const t = await getTranslations("Admin.ratings");
  const query = parseAdminRatingsQuery(await searchParams);
  const [summary, { ratings, more }] = await Promise.all([
    ratingSummary(),
    listAdminRatings(query),
  ]);
  const total = summary.reduce((sum, row) => sum + row.ratings, 0);
  const average = ratingAverage(summary);

  return (
    <>
      <section aria-label={t("summary")} className="flex flex-wrap items-stretch gap-3">
        <Card className="flex min-w-48 flex-col gap-1 p-4">
          <span className="text-13 text-muted">{t("average")}</span>
          <span className="flex items-center gap-1.5 text-28 font-black">
            <Star aria-hidden className="size-6 text-star" fill="currentColor" />
            {average === null
              ? t("noAverage")
              : t.rich("averageValue", {
                  value: average.toFixed(1),
                  num: (chunks) => <span dir="ltr">{chunks}</span>,
                })}
          </span>
          <span className="text-13 text-muted">{t("total", { count: total })}</span>
        </Card>
        <nav aria-label={t("filter")} className="flex flex-1 flex-col gap-2">
          <span className="text-13 font-bold text-muted">{t("filter")}</span>
          <ul className="flex flex-wrap gap-2">
            <li>
              <FilterLink href={adminRatingsHref({})} active={!query.stars}>
                {t("all")}
              </FilterLink>
            </li>
            {[...summary].reverse().map((row) => (
              <li key={row.stars}>
                <FilterLink
                  href={adminRatingsHref({ stars: row.stars })}
                  active={query.stars === row.stars}
                >
                  <span dir="ltr">{t("starsOption", { n: row.stars, count: row.ratings })}</span>
                </FilterLink>
              </li>
            ))}
          </ul>
        </nav>
      </section>

      {ratings.length === 0 ? (
        <Card className="py-6">
          <EmptyState
            icon={SearchX}
            title={query.stars ? t("emptyFiltered") : t("empty")}
            description={query.stars ? t("emptyFilteredBody") : t("emptyBody")}
            action={
              query.stars && (
                <Button href={routes.adminRatings} variant="secondary" size="sm">
                  {t("all")}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <RatingTable ratings={ratings} />
          {more && (
            <Button
              href={adminRatingsHref({ ...query, n: query.n + ADMIN_LIST_PAGE })}
              variant="secondary"
              size="sm"
              scroll={false}
              className="self-center"
            >
              {t("more")}
            </Button>
          )}
        </>
      )}
    </>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border-2 px-4 text-14 font-bold",
        active ? "border-navy bg-navy text-white" : "border-border bg-surface text-muted",
      )}
    >
      {children}
    </Link>
  );
}

async function RatingTable({ ratings }: { ratings: AdminRatingRow[] }) {
  const t = await getTranslations("Admin.ratings");
  const tTickets = await getTranslations("Admin.tickets");
  const tTags = await getTranslations("Report.rating.tags");
  const columns = ["when", "order", "customer", "stars", "tags", "comment", "ticket"] as const;

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-4xl text-start text-14">
        <caption className="sr-only">{t("caption")}</caption>
        <thead className="bg-well text-13 text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2.5 text-start font-bold">
                {t(`columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ratings.map((rating) => (
            <tr key={rating.orderId} className="border-t border-divider align-top">
              <td className="px-3 py-3 whitespace-nowrap">{formatDayTime(rating.createdAt)}</td>
              <td className="p-0">
                <Link
                  href={routes.adminOrder(rating.orderId)}
                  className="flex min-h-11 items-center px-3 font-extrabold text-teal underline-offset-2 hover:underline"
                >
                  <span dir="ltr">{t("orderNumber", { number: rating.orderNumber })}</span>
                </Link>
              </td>
              <td className="px-3 py-3">
                <span className="flex flex-col">
                  <span className="font-bold">{rating.customer?.full_name ?? t("noName")}</span>
                  {rating.customer && (
                    <span dir="ltr" className="text-end text-13 text-muted">
                      {formatPhone(rating.customer.phone)}
                    </span>
                  )}
                </span>
              </td>
              <td className="px-3 py-3 whitespace-nowrap">
                <span className="flex items-center gap-1 font-bold text-star">
                  <Star aria-hidden className="size-4" fill="currentColor" />
                  {t("stars", { n: rating.stars })}
                </span>
              </td>
              <td className="px-3 py-3">
                {rating.tags.length > 0
                  ? rating.tags.map((tag) => tTags(tag)).join(" · ")
                  : t("none")}
              </td>
              <td className="max-w-xs px-3 py-3 whitespace-pre-line text-body-2">
                {rating.comment ?? t("none")}
              </td>
              <td className="px-3 py-3">
                {rating.ticket ? (
                  <span className="flex flex-col items-start gap-1">
                    <Link
                      href={routes.adminTicket(rating.ticket.id)}
                      className="inline-flex min-h-11 items-center font-extrabold text-teal underline-offset-2 hover:underline"
                    >
                      <span dir="ltr">{ticketNumber(rating.ticket.number)}</span>
                    </Link>
                    <TicketStatusBadge
                      status={rating.ticket.status}
                      label={tTickets(`statuses.${rating.ticket.status}`)}
                    />
                  </span>
                ) : (
                  t("none")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RatingsSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4">
      <Skeleton className="h-28 rounded-card" />
      <Skeleton className="h-96 rounded-card" />
    </SkeletonGroup>
  );
}
