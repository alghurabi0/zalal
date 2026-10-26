"use client";

import { CalendarClock, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Fragment, type ReactNode, useState, useTransition } from "react";

import { useWeekdayList, WeekdayPicker } from "@/components/admin/weekday-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AdminSlot } from "@/lib/admin/catalog-queries";
import type { AdminEditError, AdminEditResult } from "@/lib/admin/edit-errors";
import { cn } from "@/lib/cn";
import { timeSlotParts } from "@/lib/dates";
import { CAPACITY_MAX } from "@/lib/schemas/admin-catalog";

import { createSlot, updateSlot } from "./actions";

/** A whole number from a number input; NaN when empty or not whole. */
function wholeNumber(text: string): number {
  return /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

const capacityOk = (n: number) => Number.isInteger(n) && n >= 1 && n <= CAPACITY_MAX;

/** Runs an admin edit, refreshes the page and keeps its error. */
function useEdit() {
  const router = useRouter();
  const [error, setError] = useState<AdminEditError | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<AdminEditResult>, onDone: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.status === "done") onDone();
      else setError(result.error);
      router.refresh();
    });
  };
  return { error, pending, run, clear: () => setError(null) };
}

/** The A9 slots table: each slot's times, capacity, weekdays and state, edited in place. */
export function SlotList({ slots }: { slots: AdminSlot[] }) {
  const t = useTranslations("Admin.schedule");
  const tBooking = useTranslations("Booking");
  const weekdayList = useWeekdayList();
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {slots.length === 0 ? (
        <Card className="py-6">
          <EmptyState
            icon={CalendarClock}
            title={t("emptySlots")}
            description={t("emptySlotsBody")}
            action={
              !adding && (
                <Button size="sm" onClick={() => setAdding(true)}>
                  {t("add")}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-2xl text-14">
            <caption className="sr-only">{t("slotsCaption")}</caption>
            <thead className="bg-well text-13">
              <tr>
                {(["colTime", "colCapacity", "colDays", "colUpcoming", "colState"] as const).map(
                  (key) => (
                    <th
                      key={key}
                      scope="col"
                      className="px-3 py-2.5 text-start font-bold text-muted"
                    >
                      {t(key)}
                    </th>
                  ),
                )}
                <th scope="col" className="px-3 py-2.5">
                  <span className="sr-only">{t("edit")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => {
                const label = tBooking("slot", timeSlotParts(slot.startTime, slot.endTime));
                return (
                  <Fragment key={slot.id}>
                    <tr
                      className={cn("border-t border-divider", !slot.active && "text-muted")}
                      data-testid={`slot-${slot.startTime.slice(0, 5)}-${slot.endTime.slice(0, 5)}`}
                    >
                      <th scope="row" className="px-3 py-3 text-start font-extrabold">
                        {/* A gap, not a margin: ms-* on the ltr span would point the wrong way. */}
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          {label}
                          <span dir="ltr" className="text-12 font-bold text-muted">
                            {slot.startTime.slice(0, 5)}–{slot.endTime.slice(0, 5)}
                          </span>
                        </span>
                      </th>
                      <td className="px-3 py-3">{slot.capacity}</td>
                      <td className="px-3 py-3">{weekdayList(slot.weekdays)}</td>
                      <td className="px-3 py-3">{slot.upcoming}</td>
                      <td className="px-3 py-3">
                        <span
                          className={cn(
                            "rounded-10 px-2 py-0.5 text-12 font-extrabold",
                            slot.active ? "bg-ok-bg text-ok-fg" : "bg-well text-muted",
                          )}
                        >
                          {slot.active ? t("active") : t("inactive")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-end">
                        <Button
                          size="sm"
                          variant={editing === slot.id ? "primary" : "secondary"}
                          aria-expanded={editing === slot.id}
                          aria-label={t("editLabel", { slot: label })}
                          onClick={() => setEditing(editing === slot.id ? null : slot.id)}
                        >
                          {t("edit")}
                        </Button>
                      </td>
                    </tr>
                    {editing === slot.id && (
                      <tr className="bg-bg">
                        <td colSpan={6} className="px-3 py-4">
                          <EditSlot slot={slot} label={label} onDone={() => setEditing(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <AddSlot onDone={() => setAdding(false)} />
      ) : (
        slots.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden className="size-4" />
            {t("add")}
          </Button>
        )
      )}
    </div>
  );
}

function EditSlot({ slot, label, onDone }: { slot: AdminSlot; label: string; onDone: () => void }) {
  const t = useTranslations("Admin.schedule");
  const tErrors = useTranslations("Admin.editErrors");
  const [capacity, setCapacity] = useState(String(slot.capacity));
  const [weekdays, setWeekdays] = useState(slot.weekdays);
  const [active, setActive] = useState(slot.active);
  const { error, pending, run } = useEdit();
  const capacityValue = wholeNumber(capacity);
  const valid = capacityOk(capacityValue) && weekdays.length > 0;

  return (
    <form
      aria-label={t("editLabel", { slot: label })}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        run(() => updateSlot({ id: slot.id, capacity: capacityValue, weekdays, active }), onDone);
      }}
    >
      <SlotFields
        capacity={capacity}
        onCapacity={setCapacity}
        weekdays={weekdays}
        onWeekdays={setWeekdays}
        name={`slot-${slot.id}`}
      >
        <label className="flex min-h-11 items-center gap-2.5 self-end text-14 font-bold">
          <input
            type="checkbox"
            className="size-5 accent-navy"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          {t("activeLabel")}
        </label>
      </SlotFields>
      {slot.upcoming > 0 && (
        <p className="rounded-chip bg-warn-bg px-3 py-2 text-13 font-bold text-warn-fg">
          {t("impact", { count: slot.upcoming })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={!valid}>
          {t("save")}
        </Button>
        <Button size="sm" variant="secondary" onClick={onDone}>
          {t("cancel")}
        </Button>
        <p role="status" className="text-13 font-bold text-danger">
          {error && tErrors(error)}
        </p>
      </div>
    </form>
  );
}

function AddSlot({ onDone }: { onDone: () => void }) {
  const t = useTranslations("Admin.schedule");
  const tErrors = useTranslations("Admin.editErrors");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [capacity, setCapacity] = useState("2");
  // Saturday to Thursday, like the seeded slots.
  const [weekdays, setWeekdays] = useState([0, 1, 2, 3, 4, 6]);
  const { error, pending, run } = useEdit();
  const capacityValue = wholeNumber(capacity);
  const order = start !== "" && end !== "" && start >= end;
  const valid =
    start !== "" && end !== "" && !order && capacityOk(capacityValue) && weekdays.length > 0;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h3 className="text-16 font-extrabold">{t("addTitle")}</h3>
      <form
        aria-label={t("addTitle")}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          run(() => createSlot({ start, end, capacity: capacityValue, weekdays }), onDone);
        }}
      >
        <div className="flex flex-wrap gap-4">
          <Field label={t("start")} variant="compact" className="w-36">
            {(control) => (
              <Input
                {...control}
                type="time"
                variant="compact"
                dir="ltr"
                required
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            )}
          </Field>
          <Field
            label={t("end")}
            variant="compact"
            className="w-36"
            error={order ? t("endBeforeStart") : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="time"
                variant="compact"
                dir="ltr"
                required
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            )}
          </Field>
        </div>
        <SlotFields
          capacity={capacity}
          onCapacity={setCapacity}
          weekdays={weekdays}
          onWeekdays={setWeekdays}
          name="new-slot"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={pending} disabled={!valid}>
            {t("create")}
          </Button>
          <Button size="sm" variant="secondary" onClick={onDone}>
            {t("cancel")}
          </Button>
          <p role="status" className="text-13 font-bold text-danger">
            {error && tErrors(error)}
          </p>
        </div>
      </form>
    </Card>
  );
}

function SlotFields({
  capacity,
  onCapacity,
  weekdays,
  onWeekdays,
  name,
  children,
}: {
  capacity: string;
  onCapacity: (value: string) => void;
  weekdays: number[];
  onWeekdays: (days: number[]) => void;
  name: string;
  children?: ReactNode;
}) {
  const t = useTranslations("Admin.schedule");
  const capacityValue = wholeNumber(capacity);
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
      <Field
        label={t("capacity")}
        variant="compact"
        className="w-48"
        error={capacityOk(capacityValue) ? undefined : t("capacityRange", { max: CAPACITY_MAX })}
      >
        {(control) => (
          <Input
            {...control}
            type="number"
            inputMode="numeric"
            min={1}
            max={CAPACITY_MAX}
            variant="compact"
            dir="ltr"
            className="text-start"
            value={capacity}
            onChange={(event) => onCapacity(event.target.value)}
          />
        )}
      </Field>
      <WeekdayPicker
        legend={t("weekdays")}
        name={`${name}-weekdays`}
        value={weekdays}
        onChange={onWeekdays}
        error={weekdays.length === 0 ? t("noDays") : undefined}
      />
      {children}
    </div>
  );
}
