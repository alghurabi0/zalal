import { ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { AdminPage } from "@/components/admin/admin-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { boardGrid } from "@/lib/admin/board";
import { adminOrdersHref } from "@/lib/admin/orders-query";
import { slotBoard } from "@/lib/admin/queries";
import { requireViewer } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { addDays, baghdadToday, serviceDayParts, slotParts } from "@/lib/dates";
import { routes } from "@/lib/routes";

const DAYS = 7;

/**
 * The A2 date × slot board: a week of slots with places taken out of
 * capacity, blocked days marked. A cell opens the orders in it.
 */
export default async function BoardPage(props: PageProps<"/admin/orders/board">) {
  const t = await getTranslations("Admin.board");
  return (
    <AdminPage
      title={t("title")}
      actions={
        <Button href={routes.adminOrders} variant="secondary" size="sm">
          <ClipboardList aria-hidden className="size-4" />
          {t("toOrders")}
        </Button>
      }
    >
      <Suspense fallback={<BoardSkeleton />}>
        <Board {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Board({ searchParams }: PageProps<"/admin/orders/board">) {
  await requireViewer(routes.adminBoard, "admin");
  const t = await getTranslations("Admin.board");
  const tBooking = await getTranslations("Booking");
  const today = baghdadToday();
  const raw = (await searchParams).from;
  const from = z.iso
    .date()
    .catch(today)
    .parse(Array.isArray(raw) ? raw[0] : raw);
  const dates = Array.from({ length: DAYS }, (_, i) => addDays(from, i));
  const grid = boardGrid(await slotBoard(from, DAYS), dates);
  const weekHref = (start: string) => `${routes.adminBoard}?from=${start}`;

  return (
    <>
      <nav aria-label={t("weeks")} className="flex flex-wrap items-center gap-2">
        <Button href={weekHref(addDays(from, -DAYS))} variant="secondary" size="sm">
          <ChevronRight aria-hidden className="size-4" />
          {t("previous")}
        </Button>
        {from !== today && (
          <Button href={routes.adminBoard} variant="link" size="sm">
            {t("thisWeek")}
          </Button>
        )}
        <Button href={weekHref(addDays(from, DAYS))} variant="secondary" size="sm">
          {t("next")}
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
      </nav>

      {grid.slots.length === 0 ? (
        <Card className="py-6">
          <EmptyState
            icon={ClipboardList}
            title={t("empty")}
            description={t("emptyBody")}
            action={
              <Button href={weekHref(addDays(from, DAYS))} variant="secondary" size="sm">
                {t("next")}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-3xl table-fixed text-14">
            <caption className="sr-only">{t("caption")}</caption>
            <thead className="bg-well text-13">
              <tr>
                <th scope="col" className="w-28 px-3 py-2.5 text-start font-bold text-muted">
                  {t("slot")}
                </th>
                {grid.days.map(({ date, blocked }) => {
                  const { weekday, day } = serviceDayParts(date);
                  return (
                    <th
                      key={date}
                      scope="col"
                      className={cn(
                        "px-2 py-2.5 text-center font-bold",
                        date === today && "text-teal",
                      )}
                    >
                      <span className="block">{weekday}</span>
                      <span className="block text-16 font-black">{day}</span>
                      {blocked && (
                        <span className="block text-11 font-extrabold text-danger">
                          {t("blocked")}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {grid.slots.map((slot) => (
                <tr key={slot.slotId} className="border-t border-divider">
                  <th scope="row" className="px-3 py-2 text-start font-bold whitespace-nowrap">
                    {tBooking("slot", slotParts(slot.startAt, slot.endAt))}
                  </th>
                  {grid.days.map(({ date }) => {
                    const cell = grid.cell(date, slot.slotId);
                    if (!cell) {
                      return (
                        <td key={date} className="px-2 py-2 text-center text-muted">
                          <span aria-hidden>—</span>
                          <span className="sr-only">{t("closed")}</span>
                        </td>
                      );
                    }
                    const full = cell.taken >= cell.capacity;
                    return (
                      <td key={date} className="p-1">
                        <Link
                          href={adminOrdersHref({ status: "booked", date, slot: slot.slotId })}
                          aria-label={t("cellLabel", {
                            taken: cell.taken,
                            capacity: cell.capacity,
                            date: t("dayDate", serviceDayParts(date)),
                          })}
                          className={cn(
                            "flex min-h-11 flex-col items-center justify-center rounded-chip text-15 font-extrabold",
                            cell.blocked
                              ? "bg-well text-muted"
                              : full
                                ? "bg-warn-bg text-warn-fg"
                                : cell.taken > 0
                                  ? "bg-selected text-teal"
                                  : "bg-bg text-muted",
                          )}
                        >
                          <span dir="ltr">
                            {cell.taken}/{cell.capacity}
                          </span>
                          {full && !cell.blocked && <span className="text-11">{t("full")}</span>}
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function BoardSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4">
      <Skeleton className="h-11 w-72" />
      <Skeleton className="h-80 rounded-card" />
    </SkeletonGroup>
  );
}
