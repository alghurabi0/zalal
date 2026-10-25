"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { Chip, ChipGroup } from "@/components/ui/chip";
import type { DayOption } from "@/lib/booking/availability";
import { serviceDayParts, slotParts } from "@/lib/dates";

type DaySlotPickerProps = {
  /** From bookingDays(): open days and their slots. */
  days: DayOption[];
  serviceDate: string | null;
  slotId: number | null;
  onDayChange: (serviceDate: string) => void;
  onSlotChange: (slotId: number) => void;
  /** The order's current slot when rescheduling (N7): shown, not choosable. */
  current?: { serviceDate: string; slotId: number };
};

/**
 * The day and slot chips of Booking step 1 (Booking.dc.html, spec §5.9),
 * also used by Reschedule (N7): a scrolling row of days ("ممتلئ" when every
 * slot is taken), then that day's slots with the places left.
 */
export function DaySlotPicker({
  days,
  serviceDate,
  slotId,
  onDayChange,
  onSlotChange,
  current,
}: DaySlotPickerProps) {
  const t = useTranslations("Booking");
  // Radios outside a form group by name across the whole document, and Next
  // keeps visited pages mounted, so each picker gets its own names.
  const name = useId();
  const day = days.find((d) => d.date === serviceDate) ?? null;

  if (days.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-15 font-extrabold">{t("dateLegend")}</h2>
        <p className="text-14 text-muted">{t("noDays")}</p>
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
          return (
            <Chip
              key={option.date}
              type="radio"
              name={`${name}-day`}
              value={option.date}
              checked={serviceDate === option.date}
              disabled={option.full}
              onChange={() => onDayChange(option.date)}
              className="min-h-15 w-20 shrink-0 gap-0 px-1"
            >
              <span className="text-12">{weekday}</span>
              <span className="text-18 leading-tight font-black">{dayOfMonth}</span>
              {option.full && <span className="text-11">{t("dayFull")}</span>}
            </Chip>
          );
        })}
      </ChipGroup>

      {day && (
        <ChipGroup
          legend={t("slotLegend")}
          legendClassName="sr-only"
          bodyClassName="grid grid-cols-3 gap-2"
        >
          {day.slots.map((slot) => {
            const isCurrent = current?.serviceDate === day.date && current.slotId === slot.slotId;
            return (
              <Chip
                key={slot.slotId}
                type="radio"
                name={`${name}-slot`}
                value={slot.slotId}
                checked={slotId === slot.slotId}
                disabled={!slot.bookable || isCurrent}
                onChange={() => onSlotChange(slot.slotId)}
                className="gap-0 leading-snug"
              >
                <span>{t("slot", slotParts(slot.startAt, slot.endAt))}</span>
                <span className="text-11 font-semibold">
                  {isCurrent
                    ? t("currentSlot")
                    : slot.bookable
                      ? t("remaining", { count: slot.remaining })
                      : t("slotFull")}
                </span>
              </Chip>
            );
          })}
        </ChipGroup>
      )}
    </div>
  );
}
