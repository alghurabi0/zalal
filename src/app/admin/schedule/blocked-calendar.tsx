"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CalendarDay } from "@/lib/admin/catalog-queries";
import type { AdminEditError } from "@/lib/admin/edit-errors";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { monthWeeks } from "@/lib/admin/calendar";
import { WEEK_ORDER } from "@/lib/schemas/admin-catalog";

import { blockDate, unblockDate } from "./actions";

const EMPTY_DAY: CalendarDay = { blocked: false, reason: null, booked: 0 };

/**
 * A9's blocked dates: a month grid with blocked days and places held per
 * day. Picking a day opens a panel to block it (optional reason) or open
 * it again. Blocking never touches the orders booked that day.
 */
export function BlockedCalendar({
  month,
  monthLabel,
  today,
  days,
  prevHref,
  nextHref,
  thisMonthHref,
}: {
  month: string;
  monthLabel: string;
  today: string;
  days: Record<string, CalendarDay>;
  prevHref: string;
  nextHref: string;
  thisMonthHref: string | null;
}) {
  const t = useTranslations("Admin.schedule");
  const tWeekdays = useTranslations("Admin.weekdays");
  const [selected, setSelected] = useState<string | null>(null);
  const selectedDay = selected ? (days[selected] ?? EMPTY_DAY) : null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <Card className="flex flex-col gap-3 p-4 lg:w-120">
        <nav aria-label={t("months")} className="flex items-center justify-between gap-2">
          <Button href={prevHref} variant="secondary" size="sm" aria-label={t("prevMonth")}>
            <ChevronRight aria-hidden className="size-4" />
          </Button>
          <div className="flex flex-col items-center">
            <h3 className="text-16 font-extrabold">{monthLabel}</h3>
            {thisMonthHref && (
              <Button href={thisMonthHref} variant="link" size="sm" className="h-auto px-0">
                {t("thisMonth")}
              </Button>
            )}
          </div>
          <Button href={nextHref} variant="secondary" size="sm" aria-label={t("nextMonth")}>
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
        </nav>
        <table className="w-full table-fixed text-13">
          <caption className="sr-only">{monthLabel}</caption>
          <thead>
            <tr>
              {WEEK_ORDER.map((d) => (
                <th key={d} scope="col" className="pb-1 text-center text-11 font-bold text-muted">
                  {tWeekdays(`${d}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthWeeks(month).map((week, w) => (
              <tr key={w}>
                {week.map((date, i) => {
                  if (!date) return <td key={i} />;
                  const day = days[date] ?? EMPTY_DAY;
                  const past = date < today;
                  return (
                    <td key={date} className="p-0.5">
                      <button
                        type="button"
                        aria-pressed={selected === date}
                        aria-label={t("dayLabel", {
                          date: formatDate(date),
                          blocked: day.blocked ? "yes" : "no",
                          booked: day.booked,
                        })}
                        data-date={date}
                        onClick={() => setSelected(date)}
                        className={cn(
                          "flex min-h-12 w-full flex-col items-center justify-center rounded-chip border text-14 font-bold",
                          day.blocked
                            ? "border-danger bg-danger/10 text-danger"
                            : "border-transparent bg-bg",
                          past && "text-control-off",
                          date === today && "ring-2 ring-teal",
                          selected === date && "border-navy bg-selected",
                        )}
                      >
                        <span>{Number(date.slice(8))}</span>
                        {day.booked > 0 && (
                          <span className="text-11 font-extrabold text-teal">{day.booked}</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="flex flex-1 flex-col gap-3 p-4" aria-live="polite">
        {selected && selectedDay ? (
          <DayPanel key={selected} date={selected} day={selectedDay} past={selected < today} />
        ) : (
          <p className="text-14 text-muted">{t("pickDay")}</p>
        )}
      </Card>
    </div>
  );
}

function DayPanel({ date, day, past }: { date: string; day: CalendarDay; past: boolean }) {
  const t = useTranslations("Admin.schedule");
  const tErrors = useTranslations("Admin.editErrors");
  const router = useRouter();
  const [reason, setReason] = useState(day.reason ?? "");
  const [error, setError] = useState<AdminEditError | null>(null);
  const [done, setDone] = useState<"blockedDone" | "unblockedDone" | null>(null);
  const [pending, startTransition] = useTransition();
  const trimmed = reason.trim();
  const reasonShort = trimmed.length === 1;

  const run = (block: boolean) => {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = block
        ? await blockDate({ date, reason: trimmed })
        : await unblockDate({ date });
      if (result.status === "done") setDone(block ? "blockedDone" : "unblockedDone");
      else setError(result.error);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-16 font-extrabold">
        {formatDate(date)}
        {day.blocked && (
          <span className="ms-2 rounded-10 bg-danger/10 px-2 py-0.5 text-12 font-extrabold text-danger">
            {t("blockedTag")}
          </span>
        )}
      </h3>
      <p className="text-14 text-body-2">{t("dayImpact", { count: day.booked })}</p>
      {past ? (
        <p className="text-14 text-muted">{t("pastDay")}</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reasonShort) run(true);
          }}
        >
          <Field
            label={t("reason")}
            variant="compact"
            error={reasonShort ? t("reasonShort") : undefined}
          >
            {(control) => (
              <Input
                {...control}
                variant="compact"
                maxLength={100}
                placeholder={t("reasonPlaceholder")}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              size="sm"
              loading={pending}
              disabled={reasonShort || (day.blocked && trimmed === (day.reason ?? ""))}
            >
              {day.blocked ? t("saveReason") : t("block")}
            </Button>
            {day.blocked && (
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(false)}>
                {t("unblock")}
              </Button>
            )}
          </div>
        </form>
      )}
      <p role="status" className="text-13 font-bold">
        {error ? (
          <span className="text-danger">{tErrors(error)}</span>
        ) : done ? (
          <span className="text-ok-fg">{t(done)}</span>
        ) : null}
      </p>
    </div>
  );
}
