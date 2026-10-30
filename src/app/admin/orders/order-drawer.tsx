import { ExternalLink, SearchX } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { Drawer } from "@/components/admin/drawer";
import { StatusBadge } from "@/components/orders/status-badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { adminRescheduleDays } from "@/lib/admin/board";
import { certificateNumber, ticketNumber } from "@/lib/certificates/format";
import {
  type AdminOrderDetails,
  type AdminOrderEvent,
  type CrewOption,
  getAdminOrder,
  slotBoard,
} from "@/lib/admin/queries";
import { baghdadToday, formatDay, formatDayTime, serviceDayParts, slotParts } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import { coverageFor } from "@/lib/subscriptions/state";

import { SubscriptionStateBadge } from "../subscriptions/subscription-state-badge";
import { OrderActions } from "./order-actions";
import { OrderSubscriptionButton } from "./order-subscription";

/** How far ahead an admin can reschedule from the drawer. */
const RESCHEDULE_DAYS = 30;

/**
 * The A2 order drawer: details, customer media, the timeline with staff
 * notes and crew changes, and the actions the status allows.
 */
export async function OrderDrawer({
  orderId,
  closeHref,
  crews,
}: {
  orderId: string;
  closeHref: string;
  crews: CrewOption[];
}) {
  const t = await getTranslations("Admin.drawer");
  // The server's clock; the database checks again.
  const now = new Date();
  // Both at once; the board is dropped when the order can't be rescheduled.
  const [order, board] = await Promise.all([
    getAdminOrder(orderId),
    slotBoard(baghdadToday(now), RESCHEDULE_DAYS),
  ]);

  if (!order) {
    return (
      <Drawer title={t("notFound")} closeHref={closeHref}>
        <EmptyState icon={SearchX} title={t("notFound")} description={t("notFoundBody")} />
      </Drawer>
    );
  }

  // A postponed order gets its date back through the reschedule.
  const canReschedule =
    order.status === "pending_confirmation" ||
    order.status === "confirmed" ||
    order.status === "postponed";
  const days = canReschedule ? adminRescheduleDays(board, now) : [];
  const crewName = new Map(crews.map((crew) => [crew.id, crew.name]));

  return (
    <Drawer
      closeHref={closeHref}
      title={
        <>
          {t.rich("title", {
            number: order.number,
            num: (chunks) => <span dir="ltr">{chunks}</span>,
          })}
          <StatusBadge status={order.status} className="text-13" />
        </>
      }
    >
      <Details order={order} />
      <SubscriptionSection order={order} />
      {order.customer_note && (
        <Section title={t("note")}>
          <p className="text-15 whitespace-pre-line text-body-2">{order.customer_note}</p>
        </Section>
      )}
      <Media order={order} />
      {order.status === "completed" && <CertificateAndRating order={order} />}
      <Section title={t("crew")}>
        <p className="text-15 font-bold">{order.crew?.name ?? t("noCrew")}</p>
        {order.crewChanges.length > 0 && (
          <ul className="flex flex-col gap-1 text-13 text-muted">
            {order.crewChanges.map((change) => (
              <li key={change.id}>
                {t("crewChange", {
                  to: change.to ? (crewName.get(change.to) ?? t("unknownCrew")) : t("noCrew"),
                  admin: change.admin ?? t("anAdmin"),
                  at: formatDayTime(change.at),
                })}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Card className="p-4">
        <OrderActions
          // Fresh forms after every change.
          key={`${order.status}-${order.crew_id}-${order.slot_id}-${order.service_date}`}
          orderId={order.id}
          status={order.status}
          crewId={order.crew_id}
          crews={crews.filter((crew) => crew.active || crew.id === order.crew_id)}
          days={days}
          current={{ serviceDate: order.service_date, slotId: order.slot_id }}
        />
      </Card>
      <Timeline order={order} />
    </Drawer>
  );
}

/** The certificate (links to its PDF, print page and N15) and the customer's rating. */
async function CertificateAndRating({ order }: { order: AdminOrderDetails }) {
  const t = await getTranslations("Admin.drawer");
  const tRating = await getTranslations("Report.rating");
  const { certificate, rating } = order;
  const link = "font-bold text-teal underline-offset-4 hover:underline";
  return (
    <Section title={t("certificate")}>
      {certificate ? (
        <div className="flex flex-col gap-1.5 text-15">
          <p>
            <span className="text-muted">{t("certificateNumber")}: </span>
            <span dir="ltr" className="font-bold">
              {certificateNumber(order.number)}
            </span>
            <span className="text-muted"> · {t("certificateCode")}: </span>
            <span dir="ltr" className="font-bold">
              {certificate.public_code}
            </span>
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <a href={routes.certificatePdf(order.id)} className={link}>
              {t("certificatePdf")}
            </a>
            <a
              href={routes.certificatePrint(certificate.id)}
              target="_blank"
              rel="noreferrer"
              className={link}
            >
              {t("certificatePrint")}
            </a>
            <a
              href={routes.publicCertificate(certificate.public_code)}
              target="_blank"
              rel="noreferrer"
              className={link}
            >
              {t("certificatePublic")}
            </a>
          </p>
        </div>
      ) : (
        <p className="text-14 text-muted">{t("noCertificate")}</p>
      )}
      <div className="flex flex-col gap-1.5 border-t border-divider pt-2.5">
        <h3 className="text-14 font-extrabold">{t("rating")}</h3>
        {rating ? (
          <>
            <p className="flex items-center gap-2 text-15 font-bold">
              <span aria-hidden className="text-warn-icon" dir="ltr">
                {"★".repeat(rating.stars)}
                <span className="text-track">{"★".repeat(5 - rating.stars)}</span>
              </span>
              {t("stars", { n: rating.stars })}
              <span className="text-13 font-normal text-muted">
                · {formatDayTime(rating.created_at)}
              </span>
            </p>
            {rating.tags.length > 0 && (
              <p className="text-14 text-body-2">
                {rating.tags.map((tag) => tRating(`tags.${tag}`)).join(" · ")}
              </p>
            )}
            {rating.comment && (
              <p className="text-15 whitespace-pre-line text-body-2">{rating.comment}</p>
            )}
            {rating.ticket && (
              <Link
                href={routes.adminTicket(rating.ticket.id)}
                className="inline-flex min-h-11 items-center self-start text-14 font-bold text-danger underline-offset-4 hover:underline"
              >
                {t.rich("ticket", {
                  number: ticketNumber(rating.ticket.number),
                  status: rating.ticket.status,
                  num: (chunks) => <span dir="ltr">{chunks}</span>,
                })}
              </Link>
            )}
          </>
        ) : (
          <p className="text-14 text-muted">{t("notRated")}</p>
        )}
      </div>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <h2 className="text-16 font-extrabold">{title}</h2>
      {children}
    </Card>
  );
}

async function Details({ order }: { order: AdminOrderDetails }) {
  const t = await getTranslations("Admin.drawer");
  const tBooking = await getTranslations("Booking");
  const tTanks = await getTranslations("Tanks");
  const tOrder = await getTranslations("Order");
  const tUI = await getTranslations("UI");
  const { weekday, day } = serviceDayParts(order.service_date);
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${order.lat},${order.lng}`;

  const row = (label: string, value: ReactNode) => (
    <div className="flex flex-col border-b border-divider pb-2.5 last:border-0 last:pb-0">
      <dt className="text-13 text-muted">{label}</dt>
      <dd className="text-15 font-bold">{value}</dd>
    </div>
  );

  return (
    <Card className="flex flex-col gap-3.5 p-4">
      <dl className="flex flex-col gap-2.5">
        {row(
          t("customer"),
          <>
            {order.customer?.full_name ??
              (order.customer && order.customer.phone === null ? t("deletedAccount") : t("noName"))}
            {order.customer?.phone && (
              <a
                href={`tel:${order.customer.phone}`}
                dir="ltr"
                className="block text-14 font-bold text-teal"
              >
                {formatPhone(order.customer.phone)}
              </a>
            )}
          </>,
        )}
        {row(
          t("when"),
          order.status === "postponed"
            ? t("postponed", { when: tOrder("dayDate", { weekday, day }) })
            : tOrder("whenValue", {
                weekday,
                day,
                slot: tBooking("slot", slotParts(order.slot_start_at, order.slot_end_at)),
              }),
        )}
        {row(
          t("address"),
          <>
            {order.district}
            <span className="block text-13 font-normal text-muted">{order.landmark}</span>
            <a
              href={mapUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-14 font-bold text-teal"
            >
              <ExternalLink aria-hidden className="size-4" />
              {t("openMap")}
            </a>
          </>,
        )}
        {row(
          t("payment"),
          `${tOrder(`payments.${order.payment_method}`)} · ${
            order.cash_collected ? t("cashCollected") : t("cashNotCollected")
          }`,
        )}
        {row(t("booked"), formatDayTime(order.created_at))}
      </dl>
      <div className="flex flex-col gap-2 rounded-input bg-bg p-3.5">
        <ul className="flex flex-col gap-1.5 text-14">
          {order.items.map((item, index) => (
            <li key={index} className="flex justify-between gap-3">
              <span>
                {tOrder.rich("line", {
                  type: tTanks(`types.${item.tank_type}`),
                  size: tTanks(`sizes.${item.size}`),
                  qty: item.qty,
                  keep: (chunks) => <span className="whitespace-nowrap">{chunks}</span>,
                })}
              </span>
              <span className="font-bold whitespace-nowrap">
                {tUI("iqd", { amount: formatIQD(item.qty * item.unit_price_iqd) })}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-border pt-2 text-16 font-black">
          <span>{tOrder("total")}</span>
          {order.subscription_id ? (
            <span className="text-ok-fg">{tUI("covered")}</span>
          ) : (
            <span>{tUI("iqd", { amount: formatIQD(order.total_iqd) })}</span>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * The order's subscription (§6 "verify subscription"): its state, visits,
 * period and paid tick, a link to A7, and "شيل الاشتراك" until the order is
 * completed. An uncovered order still waiting for its visit whose address
 * has a subscription that can cover it offers "استخدم الاشتراك".
 */
async function SubscriptionSection({ order }: { order: AdminOrderDetails }) {
  const t = await getTranslations("Admin.drawer.subscription");
  const tStates = await getTranslations("Admin.subscriptions.states");
  const waiting =
    order.status === "pending_confirmation" ||
    order.status === "confirmed" ||
    order.status === "postponed";
  if (!order.subscription_id && !waiting) return null;
  const subscriptions = await listSubscriptions(order.customer_id);
  const own = subscriptions.find((s) => s.id === order.subscription_id) ?? null;
  const coverage = order.subscription_id
    ? null
    : coverageFor(subscriptions, order.address_id, order.service_date, order.tanks);
  if (!own && coverage?.status !== "usable") return null;

  return (
    <Section title={t("title")}>
      {own ? (
        <div className="flex flex-col gap-1.5 text-15">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-extrabold text-ok-fg">{t("covered")}</span>
            <SubscriptionStateBadge state={own.state} label={tStates(own.state)} />
          </span>
          {own.endsOn && (
            <span>
              {t("visits", {
                left: own.visitsLeft,
                total: own.visitsTotal,
                date: formatDay(own.endsOn),
              })}
            </span>
          )}
          <span className="text-14 text-muted">{own.paid ? t("paid") : t("unpaid")}</span>
          <Link
            href={routes.adminSubscription(own.id)}
            className="inline-flex min-h-11 items-center text-14 font-bold text-teal underline"
          >
            {t("open")}
          </Link>
          {order.status !== "completed" && (
            <OrderSubscriptionButton orderId={order.id} use={false} />
          )}
        </div>
      ) : (
        <OrderSubscriptionButton orderId={order.id} use />
      )}
    </Section>
  );
}

async function Media({ order }: { order: AdminOrderDetails }) {
  const t = await getTranslations("Admin.drawer");
  if (order.media.length === 0) {
    return (
      <Section title={t("media")}>
        <p className="text-14 text-muted">{t("noMedia")}</p>
      </Section>
    );
  }
  return (
    <Section title={t("media")}>
      <ul className="grid grid-cols-3 gap-2">
        {order.media.map((file, index) => {
          const label = t("mediaLabel", { kind: file.kind, n: index + 1 });
          return (
            <li
              key={file.id}
              className="relative aspect-square overflow-hidden rounded-chip bg-well"
            >
              {!file.url ? (
                <span className="flex size-full items-center justify-center p-1 text-center text-11 text-muted">
                  {t("mediaMissing")}
                </span>
              ) : file.mediaType === "photo" ? (
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
              <span className="pointer-events-none absolute start-1.5 top-1.5 rounded-8 bg-black/55 px-1.5 text-11 font-bold text-white">
                {t(`kinds.${file.kind}`)}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

async function Timeline({ order }: { order: AdminOrderDetails }) {
  const t = await getTranslations("Admin.drawer");
  const tStatus = await getTranslations("Orders.status");
  const tOrder = await getTranslations("Order");

  const headline = (event: AdminOrderEvent) => {
    if (event.from_status === null) return t("events.booked");
    const rescheduled = rescheduledTo(event.details);
    if (rescheduled) {
      const { weekday, day } = serviceDayParts(rescheduled);
      return t("events.rescheduled", { date: tOrder("dayDate", { weekday, day }) });
    }
    return t("events.moved", {
      from: tStatus(event.from_status),
      to: tStatus(event.to_status),
    });
  };

  return (
    <Section title={t("timeline")}>
      <ol className="flex flex-col gap-3">
        {[...order.events].reverse().map((event) => {
          const note = order.notes.get(event.id);
          return (
            <li key={event.id} className="flex flex-col border-s-2 border-track ps-3">
              <span className="flex flex-wrap items-center gap-2 text-15 font-bold">
                {headline(event)}
                {event.is_override && (
                  <span className="rounded-10 bg-warn-bg px-2 text-12 font-extrabold text-warn-fg">
                    {t("override")}
                  </span>
                )}
              </span>
              <span className="text-13 text-muted">
                {event.actor?.full_name
                  ? t("byNamed", {
                      role: event.actor_role ?? "unknown",
                      name: event.actor.full_name,
                    })
                  : t("by", { role: event.actor_role ?? "unknown" })}{" "}
                · {formatDayTime(event.created_at)}
              </span>
              {event.cancel_reason && (
                <span className="text-14">{tOrder(`reasons.${event.cancel_reason}`)}</span>
              )}
              {note && (
                <p className="mt-1 rounded-chip bg-well p-2 text-14 whitespace-pre-line text-body-2">
                  <span className="sr-only">{t("noteLabel")}</span>
                  {note}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function rescheduledTo(details: unknown): string | null {
  if (details && typeof details === "object" && "to_service_date" in details) {
    const value = (details as { to_service_date: unknown }).to_service_date;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  return null;
}
