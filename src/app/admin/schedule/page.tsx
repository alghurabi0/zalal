import { CalendarCheck } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { AdminPage } from "@/components/admin/admin-page";
import { StatusBadge } from "@/components/orders/status-badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { addMonthsTo, monthRange } from "@/lib/admin/calendar";
import {
  type AdminSlot,
  adminSlots,
  scheduleCalendar,
  scheduleConflicts,
} from "@/lib/admin/catalog-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { baghdadToday, formatDate, formatMonthYear, timeSlotParts } from "@/lib/dates";
import { routes } from "@/lib/routes";

import { BlockedCalendar } from "./blocked-calendar";
import { SlotList } from "./slot-list";

/**
 * Schedule (A9, spec §8.2): the daily slots, the orders a change left out of
 * the schedule, and a month calendar of blocked days (`?month=YYYY-MM`).
 */
export default async function SchedulePage(props: PageProps<"/admin/schedule">) {
  const t = await getTranslations("Admin.schedule");
  return (
    <AdminPage title={t("title")}>
      <Suspense fallback={<ScheduleSkeleton />}>
        <Schedule {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Schedule({ searchParams }: PageProps<"/admin/schedule">) {
  await requireViewer(routes.adminSchedule, "admin");
  const t = await getTranslations("Admin.schedule");
  const now = new Date();
  const today = baghdadToday(now);
  const thisMonth = today.slice(0, 7);
  const raw = (await searchParams).month;
  const month = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .catch(thisMonth)
    .parse(Array.isArray(raw) ? raw[0] : raw);
  const { from, to } = monthRange(month);
  const [slots, conflicts, calendar] = await Promise.all([
    adminSlots(now),
    scheduleConflicts(),
    scheduleCalendar(from, to),
  ]);
  const monthHref = (m: string) => `${routes.adminSchedule}?month=${m}#blocked`;

  return (
    <>
      <section aria-labelledby="conflicts" className="flex flex-col gap-3">
        <h2 id="conflicts" className="text-18 font-extrabold">
          {t("conflictsTitle")}
          {conflicts.length > 0 && (
            <span className="ms-2 rounded-full bg-warn-bg px-2.5 py-0.5 text-14 text-warn-fg">
              {conflicts.length}
            </span>
          )}
        </h2>
        {conflicts.length === 0 ? (
          <Card className="py-6">
            <EmptyState
              icon={CalendarCheck}
              tone="success"
              title={t("conflictsEmpty")}
              description={t("conflictsEmptyBody")}
            />
          </Card>
        ) : (
          <>
            <p className="text-14 text-body-2">{t("conflictsIntro")}</p>
            <Conflicts conflicts={conflicts} slots={slots} />
          </>
        )}
      </section>

      <section aria-labelledby="slots" className="flex flex-col gap-3">
        <h2 id="slots" className="text-18 font-extrabold">
          {t("slotsTitle")}
        </h2>
        <p className="max-w-3xl text-14 text-body-2">{t("slotsIntro")}</p>
        <SlotList slots={slots} />
      </section>

      <section id="blocked" aria-labelledby="blocked-title" className="flex flex-col gap-3">
        <h2 id="blocked-title" className="text-18 font-extrabold">
          {t("calendarTitle")}
        </h2>
        <p className="max-w-3xl text-14 text-body-2">{t("calendarIntro")}</p>
        <BlockedCalendar
          key={month}
          month={month}
          monthLabel={formatMonthYear(`${month}-15T12:00:00Z`)}
          today={today}
          days={calendar}
          prevHref={monthHref(addMonthsTo(month, -1))}
          nextHref={monthHref(addMonthsTo(month, 1))}
          thisMonthHref={month === thisMonth ? null : monthHref(thisMonth)}
        />
      </section>
    </>
  );
}

/** admin_schedule_conflicts' reasons, in the order it checks them. */
const CONFLICT_REASONS = ["blocked", "slot_off", "weekday", "over_capacity"] as const;

function isConflictReason(reason: string): reason is (typeof CONFLICT_REASONS)[number] {
  return (CONFLICT_REASONS as readonly string[]).includes(reason);
}

async function Conflicts({
  conflicts,
  slots,
}: {
  conflicts: Awaited<ReturnType<typeof scheduleConflicts>>;
  slots: AdminSlot[];
}) {
  const t = await getTranslations("Admin.schedule");
  const tBooking = await getTranslations("Booking");
  const byId = new Map(slots.map((s) => [s.id, s]));
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-2xl text-14">
        <caption className="sr-only">{t("conflictsCaption")}</caption>
        <thead className="bg-well text-13">
          <tr>
            {(["colOrder", "colWhen", "colReason", "colStatus"] as const).map((key) => (
              <th key={key} scope="col" className="px-3 py-2.5 text-start font-bold text-muted">
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {conflicts.map((c) => {
            const slot = byId.get(c.slot_id);
            return (
              <tr key={c.order_id} className="border-t border-divider">
                <th scope="row" className="px-3 py-3 text-start">
                  <Link
                    href={routes.adminOrder(c.order_id)}
                    className="inline-flex min-h-11 items-center font-extrabold text-teal underline-offset-2 hover:underline"
                  >
                    <span dir="ltr">{t("orderNumber", { number: c.number })}</span>
                  </Link>
                </th>
                <td className="px-3 py-3">
                  {t("when", {
                    date: formatDate(c.service_date),
                    slot: slot ? tBooking("slot", timeSlotParts(slot.startTime, slot.endTime)) : "",
                  })}
                </td>
                <td className="px-3 py-3 font-bold text-warn-fg">
                  {isConflictReason(c.reason) && t(`reasons.${c.reason}`)}
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={c.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScheduleSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-5">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-24 rounded-card" />
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-56 rounded-card" />
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-80 rounded-card" />
    </SkeletonGroup>
  );
}
