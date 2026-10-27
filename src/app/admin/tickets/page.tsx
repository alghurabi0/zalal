import { ListFilter, SearchX } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { TicketStatusBadge } from "@/components/tickets/ticket-status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { type AdminTicketRow, listAdminTickets } from "@/lib/admin/ticket-queries";
import {
  ADMIN_LIST_PAGE,
  type AdminTicketsQuery,
  adminTicketsHref,
  parseAdminTicketsQuery,
  TICKET_SOURCE_FILTERS,
  TICKET_STATUS_FILTERS,
} from "@/lib/admin/tickets-query";
import { requireViewer } from "@/lib/auth/viewer";
import { ticketNumber } from "@/lib/certificates/format";
import { formatDayTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";

import { TicketDrawer } from "./ticket-drawer";

/**
 * Tickets (A5, spec §8.2): Issue reports and low-rating tickets, newest
 * first, filtered by status (open and in progress by default), source and a
 * search, all in the URL. The drawer (`?ticket=`) shows the ticket, changes
 * its status, keeps internal notes and opens the customer's chat.
 */
export default async function AdminTicketsPage(props: PageProps<"/admin/tickets">) {
  const t = await getTranslations("Admin.tickets");
  return (
    <AdminPage title={t("title")}>
      <Suspense fallback={<TicketsSkeleton />}>
        <Tickets {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Tickets({ searchParams }: PageProps<"/admin/tickets">) {
  await requireViewer(routes.adminTickets, "admin");
  const t = await getTranslations("Admin.tickets");
  const query = parseAdminTicketsQuery(await searchParams);
  const { tickets, more } = await listAdminTickets(query);
  const filtered = query.status !== "active" || query.source !== "all" || !!query.q;
  const listHref = (patch: Partial<AdminTicketsQuery>) => adminTicketsHref({ ...query, ...patch });

  return (
    <>
      <Filters
        // A fresh form when the URL changes (Next keeps the page alive).
        key={adminTicketsHref({ ...query, ticket: undefined, n: undefined })}
        query={query}
      />
      {tickets.length === 0 ? (
        <Card className="py-6">
          <EmptyState
            icon={SearchX}
            title={filtered ? t("emptyFiltered") : t("empty")}
            description={filtered ? t("emptyFilteredBody") : t("emptyBody")}
            action={
              filtered && (
                <Button href={routes.adminTickets} variant="secondary" size="sm">
                  {t("clear")}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <TicketTable tickets={tickets} hrefFor={(id) => listHref({ ticket: id })} />
          {more && (
            <Button
              href={listHref({ n: query.n + ADMIN_LIST_PAGE, ticket: undefined })}
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
      {query.ticket && (
        <Suspense key={query.ticket}>
          <TicketDrawer ticketId={query.ticket} closeHref={listHref({ ticket: undefined })} />
        </Suspense>
      )}
    </>
  );
}

async function Filters({ query }: { query: AdminTicketsQuery }) {
  const t = await getTranslations("Admin.tickets");
  return (
    <Form
      action={routes.adminTickets}
      className="grid grid-cols-2 items-end gap-3 rounded-card border border-border bg-surface p-4 md:grid-cols-4"
    >
      <Field label={t("status")} variant="compact">
        {(control) => (
          <Select {...control} name="status" variant="compact" defaultValue={query.status}>
            {TICKET_STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {t(`statuses.${status}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t("source")} variant="compact">
        {(control) => (
          <Select {...control} name="source" variant="compact" defaultValue={query.source}>
            {TICKET_SOURCE_FILTERS.map((source) => (
              <option key={source} value={source}>
                {t(`sources.${source}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t("search")} variant="compact" className="col-span-2">
        {(control) => (
          <Input
            {...control}
            type="search"
            name="q"
            variant="compact"
            maxLength={60}
            defaultValue={query.q ?? ""}
          />
        )}
      </Field>
      <div className="col-span-full flex gap-2 md:justify-end">
        <Button type="submit" size="sm" className="flex-1 md:flex-none">
          <ListFilter aria-hidden className="size-4" />
          {t("apply")}
        </Button>
        <Button href={routes.adminTickets} variant="secondary" size="sm">
          {t("clear")}
        </Button>
      </div>
    </Form>
  );
}

async function TicketTable({
  tickets,
  hrefFor,
}: {
  tickets: AdminTicketRow[];
  hrefFor: (id: string) => string;
}) {
  const t = await getTranslations("Admin.tickets");
  const tIssue = await getTranslations("Issue");
  const columns = ["number", "when", "customer", "subject", "order", "status"] as const;

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-3xl text-start text-14">
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
          {tickets.map((ticket) => (
            <tr key={ticket.id} className="border-t border-divider align-top">
              <td className="p-0">
                <Link
                  href={hrefFor(ticket.id)}
                  scroll={false}
                  className="flex min-h-11 items-center px-3 font-extrabold whitespace-nowrap text-teal underline-offset-2 hover:underline"
                >
                  <span dir="ltr">{ticketNumber(ticket.number)}</span>
                </Link>
              </td>
              <td className="px-3 py-3 whitespace-nowrap">{formatDayTime(ticket.createdAt)}</td>
              <td className="px-3 py-3">
                <span className="flex flex-col">
                  <span className="font-bold">{ticket.customer?.full_name ?? t("noName")}</span>
                  {ticket.customer && (
                    <span dir="ltr" className="text-end text-13 text-muted">
                      {formatPhone(ticket.customer.phone)}
                    </span>
                  )}
                </span>
              </td>
              <td className="px-3 py-3">
                {ticket.category
                  ? tIssue(`categories.${ticket.category}`)
                  : t("fromRating", { stars: ticket.stars ?? 0 })}
              </td>
              <td className="px-3 py-3">
                {ticket.order ? (
                  <Link
                    href={routes.adminOrder(ticket.order.id)}
                    className="inline-flex min-h-11 items-center font-bold text-teal underline-offset-2 hover:underline"
                  >
                    <span dir="ltr">{t("orderNumber", { number: ticket.order.number })}</span>
                  </Link>
                ) : (
                  t("none")
                )}
              </td>
              <td className="px-3 py-3">
                <TicketStatusBadge status={ticket.status} label={t(`statuses.${ticket.status}`)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TicketsSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4">
      <Skeleton className="h-24 rounded-card" />
      <Skeleton className="h-96 rounded-card" />
    </SkeletonGroup>
  );
}
