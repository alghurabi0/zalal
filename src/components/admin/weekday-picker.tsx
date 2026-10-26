"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Chip, ChipGroup } from "@/components/ui/chip";
import { WEEK_ORDER } from "@/lib/schemas/admin-catalog";

/** Weekday checkboxes, Saturday first (0 = Sunday … 6 = Saturday, as stored). */
export function WeekdayPicker({
  legend,
  value,
  onChange,
  name,
  error,
}: {
  legend: ReactNode;
  value: number[];
  onChange: (days: number[]) => void;
  name: string;
  error?: ReactNode;
}) {
  const t = useTranslations("Admin.weekdays");
  return (
    <ChipGroup legend={legend} legendClassName="text-14 font-bold">
      {WEEK_ORDER.map((day) => (
        <Chip
          key={day}
          type="checkbox"
          variant="tag"
          name={name}
          value={day}
          checked={value.includes(day)}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? [...value, day].sort((a, b) => a - b)
                : value.filter((d) => d !== day),
            )
          }
        >
          {t(`${day}`)}
        </Chip>
      ))}
      {error && <span className="basis-full text-13 font-bold text-danger">{error}</span>}
    </ChipGroup>
  );
}

// The Arabic comma and a space.
const ARABIC_LIST_SEPARATOR = "\u060C ";

/** "every day", or the days Saturday first, joined with Arabic commas. */
export function useWeekdayList() {
  const t = useTranslations("Admin.weekdays");
  const tSchedule = useTranslations("Admin.schedule");
  return (days: number[]) =>
    days.length === 7
      ? tSchedule("everyDay")
      : WEEK_ORDER.filter((d) => days.includes(d))
          .map((d) => t(`${d}`))
          .join(ARABIC_LIST_SEPARATOR);
}
