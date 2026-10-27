import { MessageCircle, SearchX, Star } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { Drawer } from "@/components/admin/drawer";
import { TicketStatusBadge } from "@/components/tickets/ticket-status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { type AdminTicketDetails, getAdminTicket } from "@/lib/admin/ticket-queries";
import { ticketNumber } from "@/lib/certificates/format";
import { formatDayTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";

import { TicketActions } from "./ticket-actions";

/**
 * The A5 ticket drawer: the customer, the order (to the A2 drawer), what
 * they reported or the rating that opened it, their files, the status
 * buttons, internal notes and "افتح المحادثة" (the customer's thread in A4,
 * where support answers).
 */
export async function TicketDrawer({
  ticketId,
  closeHref,
}: {
  ticketId: string;
  closeHref: string;
}) {
  const t = await getTranslations("Admin.tickets");
  const ticket = await getAdminTicket(ticketId);

  if (!ticket) {
    return (
      <Drawer title={t("drawer.notFound")} closeHref={closeHref}>
        <EmptyState
          icon={SearchX}
          title={t("drawer.notFound")}
          description={t("drawer.notFoundBody")}
        />
      </Drawer>
    );
  }

  return (
    <Drawer
      closeHref={closeHref}
      title={
        <>
          {t.rich("drawer.title", {
            ticket: ticketNumber(ticket.number),
            num: (chunks) => <span dir="ltr">{chunks}</span>,
          })}
          <TicketStatusBadge status={ticket.status} label={t(`statuses.${ticket.status}`)} />
        </>
      }
    >
      <Details ticket={ticket} />
      {ticket.description && (
        <Section title={t("drawer.description")}>
          <p className="text-15 whitespace-pre-line text-body-2">{ticket.description}</p>
        </Section>
      )}
      <Files ticket={ticket} />
      {ticket.threadId ? (
        <Button href={routes.adminChatThread(ticket.threadId)} size="md">
          <MessageCircle aria-hidden className="size-5" />
          {t("drawer.chat")}
        </Button>
      ) : (
        <p className="text-14 text-muted">{t("drawer.noThread")}</p>
      )}
      <Card className="p-4">
        <TicketActions
          // Fresh forms after every change.
          key={`${ticket.status}-${ticket.notes.length}`}
          ticketId={ticket.id}
          status={ticket.status}
        />
      </Card>
      <Notes ticket={ticket} />
    </Drawer>
  );
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <h2 className="text-16 font-extrabold">{title}</h2>
      {children}
    </Card>
  );
}

async function Details({ ticket }: { ticket: AdminTicketDetails }) {
  const t = await getTranslations("Admin.tickets");
  const tIssue = await getTranslations("Issue");
  const tTags = await getTranslations("Report.rating.tags");
  const row = (label: string, value: ReactNode) => (
    <div className="flex flex-col gap-0.5">
      <dt className="text-13 text-muted">{label}</dt>
      <dd className="text-15 font-bold">{value}</dd>
    </div>
  );

  return (
    <Card className="flex flex-col gap-3.5 p-4">
      <dl className="flex flex-col gap-2.5">
        {row(
          t("drawer.customer"),
          <>
            {ticket.customer?.full_name ?? t("noName")}
            {ticket.customer && (
              <a
                href={`tel:${ticket.customer.phone}`}
                dir="ltr"
                className="block text-end text-14 font-bold text-teal"
              >
                {formatPhone(ticket.customer.phone)}
              </a>
            )}
          </>,
        )}
        {row(
          t("drawer.order"),
          ticket.order ? (
            <Button
              href={routes.adminOrder(ticket.order.id)}
              variant="link"
              size="sm"
              className="px-0"
            >
              {t.rich("drawer.orderLink", {
                number: ticket.order.number,
                num: (chunks) => <span dir="ltr">{chunks}</span>,
              })}
            </Button>
          ) : (
            t("drawer.noOrder")
          ),
        )}
        {row(
          t("drawer.subject"),
          ticket.category ? (
            tIssue(`categories.${ticket.category}`)
          ) : (
            <span className="flex flex-col gap-1">
              <span className="flex items-center gap-1 text-star">
                <Star aria-hidden className="size-4" fill="currentColor" />
                {t("drawer.stars", { n: ticket.rating?.stars ?? ticket.stars ?? 0 })}
              </span>
              {ticket.rating && ticket.rating.tags.length > 0 && (
                <span className="text-14 font-normal text-body-2">
                  {ticket.rating.tags.map((tag) => tTags(tag)).join(" · ")}
                </span>
              )}
              {ticket.rating?.comment && (
                <span className="text-14 font-normal whitespace-pre-line text-body-2">
                  {ticket.rating.comment}
                </span>
              )}
            </span>
          ),
        )}
      </dl>
      <p className="text-13 text-muted">
        {t("drawer.opened", { date: formatDayTime(ticket.createdAt) })}
        {ticket.updatedAt !== ticket.createdAt &&
          ` · ${t("drawer.updated", { date: formatDayTime(ticket.updatedAt) })}`}
      </p>
    </Card>
  );
}

async function Files({ ticket }: { ticket: AdminTicketDetails }) {
  if (ticket.files.length === 0) return null;
  const t = await getTranslations("Admin.tickets.drawer");
  return (
    <Section title={t("files")}>
      <ul className="grid grid-cols-3 gap-2">
        {ticket.files.map((file, index) => {
          const label = t("file", { kind: file.kind, n: index + 1 });
          return (
            <li key={file.id} className="aspect-square overflow-hidden rounded-chip bg-well">
              {!file.url ? (
                <span className="flex size-full items-center justify-center p-1 text-center text-11 text-muted">
                  {t("fileMissing")}
                </span>
              ) : file.kind === "photo" ? (
                <a href={file.url} target="_blank" rel="noreferrer" className="block size-full">
                  {/* Signed links that expire in an hour: next/image would
                      cache them on the server, so a plain img. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={file.url} alt={label} className="size-full object-cover" />
                </a>
              ) : (
                <video
                  src={file.url}
                  controls
                  preload="metadata"
                  aria-label={label}
                  className="size-full bg-navy object-cover"
                />
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

async function Notes({ ticket }: { ticket: AdminTicketDetails }) {
  const t = await getTranslations("Admin.tickets.drawer");
  return (
    <Section title={t("notes")}>
      <p className="text-13 text-muted">{t("notesHint")}</p>
      {ticket.notes.length === 0 ? (
        <p className="text-14 text-muted">{t("noNotes")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ticket.notes.map((note) => (
            <li key={note.id} className="flex flex-col gap-0.5 rounded-chip bg-bg px-3 py-2">
              <p className="text-15 whitespace-pre-line">{note.note}</p>
              <span className="text-12 text-muted">
                {t("noteBy", {
                  name:
                    note.author?.full_name ??
                    (note.author ? formatPhone(note.author.phone) : t("anAdmin")),
                  at: formatDayTime(note.createdAt),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
