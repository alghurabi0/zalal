"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";

import { DaySlotPicker } from "@/components/booking/day-slot-picker";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { type DayOption, findSlot } from "@/lib/booking/availability";
import type { OrderChangeError } from "@/lib/orders/errors";

import { postponeOrder, rescheduleOrder } from "../actions";

import { BlockedChange, ChangeError } from "./change-messages";

/**
 * Reschedule (N7): Booking's day and slot chips, with the same rules (the
 * server leaves out slots inside the booking notice). The order goes back to
 * pending_confirmation. Below the picker, "أجّل الطلب" opens a confirm step
 * that postpones it with no date (settled Oct 29, 2026); the company sets the
 * new date later. Blocked once the current slot has started.
 */
export function RescheduleSheet({
  orderId,
  current,
  currentLabel,
  days,
  tooLate,
  children,
}: {
  orderId: string;
  current: { serviceDate: string; slotId: number };
  /** "الأحد 26 · 8–10 الصبح" */
  currentLabel: string;
  days: DayOption[];
  tooLate: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("Order");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serviceDate, setServiceDate] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<number | null>(null);
  const [error, setError] = useState<OrderChangeError | null>(null);
  const [postponing, setPostponing] = useState(false);
  const [pending, startTransition] = useTransition();
  const blocked = tooLate || error === "too_late";
  const chosen = findSlot(days, serviceDate, slotId);
  const isCurrent = serviceDate === current.serviceDate && slotId === current.slotId;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setServiceDate(null);
      setSlotId(null);
      setError(null);
      setPostponing(false);
    }
  };

  const postpone = () => {
    startTransition(async () => {
      const result = await postponeOrder({ orderId });
      if (result.status === "done") {
        setOpen(false);
        router.refresh();
        return;
      }
      setError(result.error);
      if (result.error === "invalid_transition" || result.error === "too_late") router.refresh();
    });
  };

  const confirm = () => {
    if (!chosen || !serviceDate || isCurrent) return;
    startTransition(async () => {
      const result = await rescheduleOrder({ orderId, serviceDate, slotId: chosen.slotId });
      if (result.status === "done") {
        setOpen(false);
        router.refresh();
        return;
      }
      setError(result.error);
      if (result.error === "slot_full" || result.error === "slot_unavailable") {
        setSlotId(null);
        // Fresh places for the chips.
        router.refresh();
      }
      // The page behind the sheet shows the new state too.
      if (result.error === "invalid_transition" || result.error === "too_late") router.refresh();
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      {blocked ? (
        <SheetContent title={t("blocked.title")}>
          <BlockedChange orderId={orderId} />
        </SheetContent>
      ) : postponing ? (
        <SheetContent
          title={t("postponeSheet.title")}
          description={t("postponeSheet.body")}
          busy={pending}
        >
          {error && <ChangeError error={error} />}
          <Button size="footer" className="w-full" loading={pending} onClick={postpone}>
            {t("postponeSheet.confirm")}
          </Button>
          <Button
            variant="secondary"
            size="footer"
            className="w-full"
            disabled={pending}
            onClick={() => {
              setPostponing(false);
              setError(null);
            }}
          >
            {t("postponeSheet.back")}
          </Button>
        </SheetContent>
      ) : (
        <SheetContent
          title={t("rescheduleSheet.title")}
          description={t("rescheduleSheet.description")}
          busy={pending}
        >
          <p className="text-14 text-muted">
            {t.rich("rescheduleSheet.current", {
              when: currentLabel,
              b: (chunks) => <span className="font-bold text-navy">{chunks}</span>,
            })}
          </p>
          <DaySlotPicker
            days={days}
            serviceDate={serviceDate}
            slotId={slotId}
            onDayChange={(date) => {
              setServiceDate(date);
              setSlotId(null);
              setError(null);
            }}
            onSlotChange={(id) => {
              setSlotId(id);
              setError(null);
            }}
            current={current}
          />
          {error && <ChangeError error={error} />}
          <Button
            size="footer"
            className="w-full"
            disabled={!chosen?.bookable || isCurrent}
            loading={pending}
            onClick={confirm}
          >
            {t("rescheduleSheet.confirm")}
          </Button>
          <div className="flex flex-wrap items-center justify-center gap-x-1 border-t border-divider pt-3 text-14 text-muted">
            {t("rescheduleSheet.postponeQuestion")}
            <Button
              variant="link"
              size="sm"
              disabled={pending}
              onClick={() => {
                setPostponing(true);
                setError(null);
              }}
            >
              {t("rescheduleSheet.postpone")}
            </Button>
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}
