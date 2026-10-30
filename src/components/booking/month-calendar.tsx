"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { loadBookingDays } from "@/app/(customer)/book/actions";
import { ErrorState } from "@/components/ui/error-state";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import type { DayOption } from "@/lib/booking/availability";
import { addMonth, monthOf, monthRange, monthWeeks } from "@/lib/booking/calendar";
import { cn } from "@/lib/cn";
import { baghdadToday, formatDay, formatDayMonth, serviceDayParts } from "@/lib/dates";

const WEEKDAYS = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"] as const;

type MonthState = { status: "loading" } | { status: "error" } | { status: "ok"; days: DayOption[] };

/**
 * The month calendar behind "تاريخ آخر" (spec §5.9): any future day can be
 * booked (settled Oct 30, 2026). A day opens when it has a slot left; full
 * days say "ممتلئ"; past, blocked and closed days are off. Each month is read
 * once from booking_availability() while the calendar is open.
 */
export function MonthCalendar({
  id,
  selected,
  onPick,
}: {
  id?: string;
  selected: string | null;
  onPick: (day: DayOption) => void;
}) {
  const t = useTranslations("Booking.calendar");
  // The device's date only picks the first month shown; the server decides what opens.
  const [firstMonth] = useState(() => monthOf(baghdadToday()));
  const [month, setMonth] = useState(() =>
    selected && selected >= firstMonth ? monthOf(selected) : firstMonth,
  );
  const [months, setMonths] = useState<Record<string, MonthState>>({});
  const state = months[month] ?? { status: "loading" };

  // Months being read, so a re-render doesn't read one twice.
  const reading = useRef(new Set<string>());

  useEffect(() => {
    if (months[month] !== undefined || reading.current.has(month)) return;
    reading.current.add(month);
    void loadBookingDays(monthRange(month)).then((result) => {
      reading.current.delete(month);
      setMonths((all) => ({
        ...all,
        [month]: result.status === "ok" ? { status: "ok", days: result.days } : { status: "error" },
      }));
    });
  }, [month, months]);

  // Forgetting the month reads it again.
  const retry = () =>
    setMonths((all) => Object.fromEntries(Object.entries(all).filter(([key]) => key !== month)));

  return (
    <section
      id={id}
      aria-label={t("title")}
      className="flex flex-col gap-2 rounded-input border border-border bg-surface p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <IconButton
          label={t("previous")}
          icon={ChevronRight}
          variant="soft"
          disabled={month <= firstMonth}
          onClick={() => setMonth((m) => addMonth(m, -1))}
          className="disabled:opacity-40"
        />
        <h3 className="text-15 font-extrabold" aria-live="polite">
          {formatDayMonth(`${month}-01`)}
        </h3>
        <IconButton
          label={t("next")}
          icon={ChevronLeft}
          variant="soft"
          onClick={() => setMonth((m) => addMonth(m, 1))}
        />
      </div>

      {state.status === "error" ? (
        <ErrorState titleAs="h2" onRetry={retry} className="py-4" />
      ) : state.status === "loading" ? (
        <SkeletonGroup className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }, (_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </SkeletonGroup>
      ) : (
        <table className="w-full table-fixed border-separate border-spacing-1">
          <thead>
            <tr>
              {WEEKDAYS.map((weekday) => (
                <th
                  key={weekday}
                  scope="col"
                  abbr={t(`weekdays.${weekday}`)}
                  className="text-12 font-bold text-muted"
                >
                  {t(`weekdaysShort.${weekday}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthWeeks(month).map((week, row) => (
              <tr key={row}>
                {week.map((date, column) => (
                  <td key={date ?? `empty-${column}`} className="p-0">
                    {date && (
                      <DayCell
                        date={date}
                        day={state.days.find((d) => d.date === date)}
                        selected={date === selected}
                        onPick={onPick}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function DayCell({
  date,
  day,
  selected,
  onPick,
}: {
  date: string;
  day: DayOption | undefined;
  selected: boolean;
  onPick: (day: DayOption) => void;
}) {
  const t = useTranslations("Booking");
  const open = day !== undefined && !day.full;
  const full = day?.full === true;
  const { weekday } = serviceDayParts(date);

  return (
    <button
      type="button"
      disabled={!open}
      aria-pressed={selected}
      aria-label={`${weekday} ${formatDay(date)}${full ? ` · ${t("dayFull")}` : ""}`}
      onClick={() => day && onPick(day)}
      className={cn(
        "flex min-h-12 w-full flex-col items-center justify-center rounded-chip text-15 font-extrabold",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
        open && !selected && "bg-bg text-navy",
        selected && "bg-navy text-white",
        !open && "cursor-not-allowed text-control-off",
      )}
    >
      <span>{Number(date.slice(8))}</span>
      {full && <span className="text-11 leading-none font-semibold">{t("dayFull")}</span>}
    </button>
  );
}
