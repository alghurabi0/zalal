"use client";

import { CalendarDays } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Chip, ChipGroup } from "@/components/ui/chip";
import type { DayOption, SlotOption } from "@/lib/booking/availability";
import { cn } from "@/lib/cn";
import { addDays, baghdadToday, formatMonthName, serviceDayParts, slotParts } from "@/lib/dates";

import { MonthCalendar } from "./month-calendar";

type DaySlotPickerProps = {
  /** From bookingDays(): open days and their slots. */
  days: DayOption[];
  serviceDate: string | null;
  slotId: number | null;
  onDayChange: (serviceDate: string) => void;
  onSlotChange: (slotId: number) => void;
  /** The order's current slot when rescheduling (N7): shown, not choosable. */
  current?: { serviceDate: string; slotId: number };
  /** Each open slot's places left; only admins see them (settled Oct 29, 2026). */
  showRemaining?: boolean;
  /**
   * Customers: "تاريخ آخر" after the days opens a month calendar for any
   * later day (spec §5.9). Gets the picked day, which the caller adds to
   * `days` (useOtherDay), before onDayChange.
   */
  onOtherDay?: (day: DayOption) => void;
};

/**
 * The day and slot chips of Booking step 1 (Booking.dc.html, spec §5.9),
 * also used by Reschedule (N7) and the admin's reschedule: a scrolling row of
 * days ("ممتلئ" when every slot is taken), then that day's slots. With
 * onOtherDay, the row ends with "تاريخ آخر", which opens the month calendar
 * below it.
 */
export function DaySlotPicker({
  days,
  serviceDate,
  slotId,
  onDayChange,
  onSlotChange,
  current,
  showRemaining = false,
  onOtherDay,
}: DaySlotPickerProps) {
  const t = useTranslations("Booking");
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Radios outside a form group by name across the whole document, and Next
  // keeps visited pages mounted, so each picker gets its own names.
  const name = useId();
  const day = days.find((d) => d.date === serviceDate) ?? null;
  const isCurrent = (date: string, slot: SlotOption) =>
    current?.serviceDate === date && current.slotId === slot.slotId;

  const calendarId = `${name}-calendar`;
  // A day picked in the calendar, past the row's two weeks, names its month.
  const rowEnd = addDays(baghdadToday(), 13);
  const otherDayButton = onOtherDay && (
    <button
      type="button"
      aria-expanded={calendarOpen}
      aria-controls={calendarId}
      onClick={() => setCalendarOpen((open) => !open)}
      className={cn(
        "flex min-h-15 w-20 shrink-0 flex-col items-center justify-center gap-0.5 rounded-chip border-2 px-1 text-12 font-bold",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
        calendarOpen ? "border-navy bg-selected text-navy" : "border-border bg-surface text-teal",
      )}
    >
      <CalendarDays aria-hidden className="size-5" strokeWidth={2} />
      {t("calendar.open")}
    </button>
  );
  const calendar = onOtherDay && calendarOpen && (
    <MonthCalendar
      id={calendarId}
      selected={serviceDate}
      onPick={(picked) => {
        onOtherDay(picked);
        onDayChange(picked.date);
        setCalendarOpen(false);
      }}
    />
  );

  if (days.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-15 font-extrabold">{t("dateLegend")}</h2>
        <p className="text-14 text-muted">{onOtherDay ? t("noDaysOther") : t("noDays")}</p>
        {otherDayButton}
        {calendar}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ChipGroup
        legend={t("dateLegend")}
        // A fieldset is as wide as its content unless told otherwise, so the
        // scrolling row of days would widen the page.
        className="min-w-0"
        // Edge to edge: screens and sheets both pad 20px.
        bodyClassName="-mx-5 flex-nowrap overflow-x-auto px-5 pt-0.5 pb-1"
      >
        {days.map((option) => {
          const { weekday, day: dayOfMonth } = serviceDayParts(option.date);
          // When rescheduling, the order's own slot doesn't count as a choice.
          const full = !option.slots.some((slot) => slot.bookable && !isCurrent(option.date, slot));
          return (
            <Chip
              key={option.date}
              type="radio"
              name={`${name}-day`}
              value={option.date}
              checked={serviceDate === option.date}
              disabled={full}
              onChange={() => onDayChange(option.date)}
              className="min-h-15 w-20 shrink-0 gap-0 px-1"
            >
              <span className="text-12">{weekday}</span>
              <span className="text-18 leading-tight font-black">{dayOfMonth}</span>
              {full ? (
                <span className="text-11">{t("dayFull")}</span>
              ) : (
                option.date > rowEnd && (
                  <span className="text-11">{formatMonthName(option.date)}</span>
                )
              )}
            </Chip>
          );
        })}
        {otherDayButton}
      </ChipGroup>
      {calendar}

      {day && (
        <ChipGroup
          legend={t("slotLegend")}
          legendClassName="sr-only"
          bodyClassName="grid grid-cols-3 gap-2"
        >
          {day.slots.map((slot) => {
            const currentSlot = isCurrent(day.date, slot);
            const note = currentSlot
              ? t("currentSlot")
              : !slot.bookable
                ? t("slotFull")
                : showRemaining
                  ? t("remaining", { count: slot.remaining })
                  : null;
            return (
              <Chip
                key={slot.slotId}
                type="radio"
                name={`${name}-slot`}
                value={slot.slotId}
                checked={slotId === slot.slotId}
                disabled={!slot.bookable || currentSlot}
                onChange={() => onSlotChange(slot.slotId)}
                className="gap-0 leading-snug"
              >
                <span>{t("slot", slotParts(slot.startAt, slot.endAt))}</span>
                {note && <span className="text-11 font-semibold">{note}</span>}
              </Chip>
            );
          })}
        </ChipGroup>
      )}
    </div>
  );
}
