"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Chip, ChipGroup } from "@/components/ui/chip";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import type { OrderChangeError } from "@/lib/orders/errors";
import { CANCEL_REASONS, type CancelReason } from "@/lib/orders/status";

import { cancelOrder } from "../actions";

import { BlockedChange, ChangeError } from "./change-messages";

/**
 * Cancel (N6): a reason, then confirm. Within 2 h of the slot it only says
 * "راسلنا بالمحادثة"; the database refuses the change either way (ZL006).
 */
export function CancelSheet({
  orderId,
  tooLate,
  children,
}: {
  orderId: string;
  /** The server found the order inside the cutoff when the page loaded. */
  tooLate: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("Order");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [error, setError] = useState<OrderChangeError | null>(null);
  const [pending, startTransition] = useTransition();
  const name = useId();
  const blocked = tooLate || error === "too_late";

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setReason(null);
      setError(null);
    }
  };

  const confirm = () => {
    if (!reason) return;
    startTransition(async () => {
      const result = await cancelOrder({ orderId, reason });
      if (result.status === "done") {
        setOpen(false);
        router.refresh();
        return;
      }
      setError(result.error);
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
      ) : (
        <SheetContent
          title={t("cancelSheet.title")}
          description={t("cancelSheet.description")}
          busy={pending}
        >
          <ChipGroup
            legend={t("cancelSheet.legend")}
            legendClassName="sr-only"
            bodyClassName="flex-col"
          >
            {CANCEL_REASONS.map((value) => (
              <Chip
                key={value}
                type="radio"
                name={`${name}-reason`}
                value={value}
                checked={reason === value}
                onChange={() => setReason(value)}
                className="min-h-13 items-start px-4 text-15"
              >
                {t(`reasons.${value}`)}
              </Chip>
            ))}
          </ChipGroup>
          {error && <ChangeError error={error} />}
          <Button
            size="footer"
            className="w-full"
            disabled={!reason}
            loading={pending}
            onClick={confirm}
          >
            {t("cancelSheet.confirm")}
          </Button>
          <SheetClose asChild>
            <Button variant="link" size="sm" className="w-full" disabled={pending}>
              {t("cancelSheet.keep")}
            </Button>
          </SheetClose>
        </SheetContent>
      )}
    </Sheet>
  );
}
