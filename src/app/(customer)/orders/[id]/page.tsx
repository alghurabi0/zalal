import { CalendarClock, SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { z } from "zod";

import { Screen } from "@/components/layout/screen";
import { LiveOrders } from "@/components/orders/live-orders";
import { StatusBadge } from "@/components/orders/status-badge";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/auth/viewer";
import { bookingDays } from "@/lib/booking/availability";
import { cn } from "@/lib/cn";
import { formatDayTime, serviceDayParts, slotParts } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { getOrder, type OrderDetails } from "@/lib/orders/queries";
import { actionHref, canFollowJob, changeState, primaryAction } from "@/lib/orders/status";
import { buildTimeline, type TimelineEntry } from "@/lib/orders/timeline";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

import { CancelSheet } from "./cancel-sheet";
import { RescheduleSheet } from "./reschedule-sheet";

/**
 * Order details (N4): status, timeline, summary, price and attachments, with
 * the buttons its status allows. Cancel (N6) and reschedule (N7) open
 * sheets. From the crew setting off it links to Tracking and then Job
 * progress, and once completed to the certificate (Report) and the job's
 * files; help comes with Chat in Phase 5.
 */
export default function OrderPage(props: PageProps<"/orders/[id]">) {
  return (
    <Screen className="bg-bg">
      <Suspense fallback={<OrderSkeleton />}>
        <OrderContent {...props} />
      </Suspense>
    </Screen>
  );
}

async function OrderContent({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const viewer = await requireViewer(routes.order(id));
  const t = await getTranslations("Order");
  const orderId = z.uuid().safeParse(id);
  const [order, cutoff] = await Promise.all([
    orderId.success ? getOrder(orderId.data) : null,
    cancelCutoffHours(),
  ]);

  if (!order) {
    return (
      <>
        <Header />
        <EmptyState
          icon={SearchX}
          titleAs="h1"
          title={t("notFound")}
          description={t("notFoundBody")}
          action={
            <Button href={routes.orders} size="footer" className="w-full">
              {t("toOrders")}
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <LiveOrders customerId={viewer.id} />
      <Header>
        <h1 className="flex-1 text-20 font-black">
          {t.rich("title", {
            number: order.number,
            num: (chunks) => <span dir="ltr">{chunks}</span>,
          })}
        </h1>
        <StatusBadge status={order.status} className="text-13" />
      </Header>
      <div className="flex flex-1 flex-col gap-3 px-4 pb-6">
        <Summary order={order} />
        {order.customer_note && (
          <Section title={t("note")}>
            <p className="text-15 whitespace-pre-line text-body-2">{order.customer_note}</p>
          </Section>
        )}
        {order.media.length > 0 && <Files order={order} />}
        <Timeline entries={buildTimeline(order.events)} />
      </div>
      <Actions order={order} cutoff={cutoff} />
    </>
  );
}

function Header({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-5 pt-5 pb-3.5">
      <BackButton href={routes.orders} />
      {children}
    </div>
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

async function Summary({ order }: { order: OrderDetails }) {
  const t = await getTranslations("Order");
  const tBooking = await getTranslations("Booking");
  const tTanks = await getTranslations("Tanks");
  const tLabels = await getTranslations("Location.labels");
  const tUI = await getTranslations("UI");
  const { weekday, day } = serviceDayParts(order.service_date);

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
          t("when"),
          t("whenValue", {
            weekday,
            day,
            slot: tBooking("slot", slotParts(order.slot_start_at, order.slot_end_at)),
          }),
        )}
        {row(
          t("address"),
          <>
            {order.label
              ? t("addressValue", { label: tLabels(order.label), district: order.district })
              : order.district}
            <span className="block text-13 font-normal text-muted">{order.landmark}</span>
          </>,
        )}
        {row(t("payment"), t(`payments.${order.payment_method}`))}
      </dl>
      <div className="flex flex-col gap-2 rounded-input bg-bg p-3.5">
        <h2 className="text-14 font-extrabold">{t("service")}</h2>
        <ul className="flex flex-col gap-1.5 text-14">
          {order.items.map((item, index) => (
            <li key={index} className="flex justify-between gap-3">
              <span>
                {t.rich("line", {
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
          <li className="flex justify-between gap-3">
            <span>{t("certificate")}</span>
            <span className="font-bold text-ok-fg">{t("free")}</span>
          </li>
        </ul>
        <div className="flex justify-between border-t border-border pt-2 text-16 font-black">
          <span>{t("total")}</span>
          <span>{tUI("iqd", { amount: formatIQD(order.total_iqd) })}</span>
        </div>
      </div>
    </Card>
  );
}

async function Files({ order }: { order: OrderDetails }) {
  const t = await getTranslations("Order");
  let photos = 0;
  let videos = 0;
  return (
    <Section title={t("files")}>
      <ul className="grid grid-cols-3 gap-2">
        {order.media.map((file) => {
          const label =
            file.mediaType === "photo" ? t("photo", { n: ++photos }) : t("video", { n: ++videos });
          return (
            <li key={file.id} className="aspect-square overflow-hidden rounded-chip bg-well">
              {!file.url ? (
                <span className="flex size-full items-center justify-center p-1 text-center text-11 text-muted">
                  {t("fileMissing")}
                </span>
              ) : file.mediaType === "photo" ? (
                <a href={file.url} target="_blank" rel="noreferrer" className="block size-full">
                  {/* Private files behind signed links that expire in an hour:
                      next/image would cache them on the server, so a plain img. */}
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

async function Timeline({ entries }: { entries: TimelineEntry[] }) {
  const t = await getTranslations("Order");
  const text = (entry: TimelineEntry) => {
    switch (entry.kind) {
      case "booked":
        return t("events.booked");
      case "rescheduled": {
        const by = entry.by === "you" ? "you" : "company";
        if (!entry.toDate) return t("events.rescheduled", { by });
        const { weekday, day } = serviceDayParts(entry.toDate);
        return t("events.rescheduledTo", { by, date: t("dayDate", { weekday, day }) });
      }
      case "cancelled": {
        const by = entry.by === "you" ? "you" : "company";
        return entry.reason
          ? `${t("events.cancelled", { by })} · ${t(`reasons.${entry.reason}`)}`
          : t("events.cancelled", { by });
      }
      case "status":
        return t(`events.${entry.status}`);
    }
  };

  return (
    <Section title={t("timeline")}>
      <ol className="flex flex-col">
        {entries.map((entry, index) => {
          const last = index === entries.length - 1;
          return (
            <li key={entry.id} className="flex gap-3">
              <span aria-hidden className="flex flex-col items-center">
                <span
                  className={cn(
                    "mt-1.5 size-3 shrink-0 rounded-full",
                    last ? "bg-teal" : "bg-track",
                  )}
                />
                {!last && <span className="w-0.5 flex-1 bg-track" />}
              </span>
              <span className={cn("flex flex-col", !last && "pb-3")}>
                <span className={cn("text-15", last ? "font-extrabold" : "font-bold")}>
                  {text(entry)}
                </span>
                <span className="text-13 text-muted">{formatDayTime(entry.at)}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/** The buttons the order's status allows, in a footer. */
async function cancelCutoffHours(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("cancel_cutoff_hours").single();
  if (error) throw new Error(`Settings read failed: ${error.message}`);
  return data.cancel_cutoff_hours;
}

async function Actions({ order, cutoff }: { order: OrderDetails; cutoff: number }) {
  const t = await getTranslations("Order");
  const tBooking = await getTranslations("Booking");

  if (order.status === "cancelled") {
    return (
      <Footer>
        <Button href={routes.book} size="footer" className="w-full">
          {t("rebook")}
        </Button>
      </Footer>
    );
  }

  // Once completed: the certificate (§5.15), and the job's photos and clips.
  if (order.status === "completed") {
    return (
      <Footer>
        <div className="flex gap-2.5">
          <Button href={routes.certificate(order.id)} size="footer" className="flex-1">
            {t("certificateButton")}
          </Button>
          <Button href={routes.jobProgress(order.id)} size="footer" variant="secondary">
            {t("jobMedia")}
          </Button>
        </div>
      </Footer>
    );
  }

  // From the crew setting off: Tracking, then Job progress (§5.13, §5.14).
  const action = primaryAction(order.status);
  if (action === "track" || canFollowJob(order.status)) {
    return (
      <Footer>
        <Button
          href={action === "track" ? actionHref(action, order.id) : routes.jobProgress(order.id)}
          size="footer"
          className="w-full"
        >
          {action === "track" ? t("track") : t("progress")}
        </Button>
      </Footer>
    );
  }

  // The server's clock, never the device's; the database checks again.
  const now = new Date();
  const state = changeState(order.status, order.slot_start_at, now, cutoff);
  if (state === "closed") return null;

  const tooLate = state === "too_late";
  const supabase = await createClient();
  const { data: availability, error: availabilityError } = tooLate
    ? { data: [], error: null }
    : await supabase.rpc("booking_availability");
  if (availabilityError) throw new Error(`Availability failed: ${availabilityError.message}`);
  const { weekday, day } = serviceDayParts(order.service_date);

  return (
    <Footer>
      <p
        className={cn(
          "flex items-start gap-2 text-13",
          tooLate ? "font-bold text-warn-fg" : "text-muted",
        )}
      >
        <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0" />
        {tooLate ? t("tooLateHint") : t("changeHint")}
      </p>
      <div className="flex gap-2">
        <RescheduleSheet
          orderId={order.id}
          current={{ serviceDate: order.service_date, slotId: order.slot_id }}
          currentLabel={t("whenValue", {
            weekday,
            day,
            slot: tBooking("slot", slotParts(order.slot_start_at, order.slot_end_at)),
          })}
          days={bookingDays(availability, now, cutoff)}
          tooLate={tooLate}
        >
          <Button size="footer" className="flex-1">
            {t("reschedule")}
          </Button>
        </RescheduleSheet>
        <CancelSheet orderId={order.id} tooLate={tooLate}>
          <Button variant="secondary" size="footer" className="flex-1 text-danger">
            {t("cancel")}
          </Button>
        </CancelSheet>
      </div>
    </Footer>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <footer className="sticky bottom-0 z-10 flex flex-col gap-2.5 border-t border-border bg-surface px-5 pt-3 pb-safe-5.5">
      {children}
    </footer>
  );
}

function OrderSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-3 px-4 pt-5">
      <div className="flex items-center gap-3 px-1">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="h-7 w-32" />
      </div>
      <Skeleton className="h-64 rounded-card" />
      <Skeleton className="h-40 rounded-card" />
    </SkeletonGroup>
  );
}
