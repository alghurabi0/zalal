"use client";

import { MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { SheetClose } from "@/components/ui/sheet";
import type { OrderChangeError } from "@/lib/orders/errors";

/**
 * Inside the cutoff (N6, N7): "راسلنا بالمحادثة". The chat button comes with
 * Chat in Phase 5.
 */
export function BlockedChange() {
  const t = useTranslations("Order");
  return (
    <>
      <p role="alert" className="flex gap-2.5 rounded-input bg-warn-bg p-3.5 text-15 text-warn-fg">
        <MessageCircle aria-hidden className="mt-1 size-5 shrink-0" strokeWidth={2} />
        <span className="font-bold">{t("blocked.body")}</span>
      </p>
      <SheetClose asChild>
        <Button variant="secondary" size="footer" className="w-full">
          {t("blocked.ok")}
        </Button>
      </SheetClose>
    </>
  );
}

export function ChangeError({ error }: { error: OrderChangeError }) {
  const t = useTranslations("Order.errors");
  return (
    <p
      role="alert"
      className="rounded-input bg-warn-bg px-3.5 py-2.5 text-14 font-bold text-warn-fg"
    >
      {t(error)}
    </p>
  );
}
