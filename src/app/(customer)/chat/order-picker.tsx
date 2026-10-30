"use client";

import { CalendarX2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import type { ChatTopic } from "@/lib/chat/messages";
import type { ChatOrder } from "@/lib/chat/queries";
import { serviceDayParts, slotParts } from "@/lib/dates";

/**
 * Chat's order picker (spec §5.16): تغيير موعد and إلغاء طلب ask which
 * order, from the customer's pending, confirmed and postponed ones, soonest
 * first. Orders whose slot has started are listed too, and so is a postponed
 * order under تغيير موعد (support sets its date): the message then asks
 * support, without the in-app button.
 */
export function OrderPicker({
  topic,
  orders,
  onPick,
  onClose,
}: {
  topic: ChatTopic | null;
  orders: ChatOrder[];
  onPick: (topic: ChatTopic, order: ChatOrder) => void;
  onClose: () => void;
}) {
  const t = useTranslations("Chat.picker");
  const tBooking = useTranslations("Booking");
  const tUI = useTranslations("UI");
  const which = topic === "reschedule" || topic === "cancel" ? topic : null;

  return (
    <Sheet open={which !== null} onOpenChange={(next) => !next && onClose()}>
      {which && (
        <SheetContent
          title={t(which)}
          description={orders.length > 0 ? t("description") : undefined}
        >
          {orders.length === 0 ? (
            <>
              <EmptyState
                icon={CalendarX2}
                title={t("empty")}
                description={t("emptyBody")}
                className="py-4"
              />
              <SheetClose asChild>
                <Button variant="secondary" size="footer" className="w-full">
                  {tUI("close")}
                </Button>
              </SheetClose>
            </>
          ) : (
            <ul className="flex flex-col gap-2">
              {orders.map((order) => {
                const { weekday, day } = serviceDayParts(order.serviceDate);
                return (
                  <li key={order.id}>
                    <button
                      type="button"
                      onClick={() => onPick(which, order)}
                      className="flex min-h-14 w-full flex-col items-start justify-center rounded-input border border-border bg-surface px-4 py-2 text-start focus-visible:outline-2 focus-visible:outline-teal"
                    >
                      <span className="text-15 font-extrabold">
                        {t.rich("order", {
                          number: order.number,
                          num: (chunks) => <span dir="ltr">{chunks}</span>,
                        })}
                      </span>
                      <span className="text-13 text-muted">
                        {order.status === "postponed"
                          ? t("postponed")
                          : t("when", {
                              weekday,
                              day,
                              slot: tBooking("slot", slotParts(order.slotStartAt, order.slotEndAt)),
                            })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </SheetContent>
      )}
    </Sheet>
  );
}
