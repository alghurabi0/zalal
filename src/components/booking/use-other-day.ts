"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { loadBookingDays } from "@/app/(customer)/book/actions";
import { type DayOption, withExtraDay } from "@/lib/booking/availability";

/**
 * The days a customer's DaySlotPicker offers: the server's row of days plus
 * one picked in the month calendar ("تاريخ آخر", spec §5.9). A selected day
 * outside the row (after a reload, or when the page's days were read again
 * after a full slot) is read again, so its places are never stale.
 */
export function useOtherDay(days: DayOption[], selected: string | null) {
  const [extra, setExtra] = useState<DayOption | null>(null);
  // The `days` the extra day was read alongside.
  const readWith = useRef<DayOption[] | null>(null);

  useEffect(() => {
    if (!selected || days.some((day) => day.date === selected)) return;
    if (readWith.current === days && extra?.date === selected) return;
    let live = true;
    void loadBookingDays({ from: selected, to: selected }).then((result) => {
      if (!live || result.status !== "ok") return;
      readWith.current = days;
      setExtra(result.days.find((day) => day.date === selected) ?? null);
    });
    return () => {
      live = false;
    };
  }, [days, selected, extra]);

  return {
    days: useMemo(() => withExtraDay(days, extra), [days, extra]),
    /** The calendar's pick, read just now. */
    pick: (day: DayOption) => {
      readWith.current = days;
      setExtra(day);
    },
  };
}
