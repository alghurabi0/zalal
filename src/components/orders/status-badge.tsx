import { useTranslations } from "next-intl";

import { cn } from "@/lib/cn";
import { type BadgeTone, badgeTone, type OrderStatus } from "@/lib/orders/status";

const toneClasses: Record<BadgeTone, string> = {
  info: "bg-selected text-teal",
  warn: "bg-warn-bg text-warn-fg",
  ok: "bg-ok-bg text-ok-fg",
  neutral: "bg-well text-muted",
};

/**
 * An order's status pill (Orders.dc.html). `label` replaces the customer's
 * wording, e.g. the crew app's "وصلنا".
 */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: OrderStatus;
  label?: string;
  className?: string;
}) {
  const t = useTranslations("Orders.status");
  return (
    <span
      className={cn(
        "shrink-0 rounded-10 px-2.5 py-0.5 text-12 font-extrabold whitespace-nowrap",
        toneClasses[badgeTone(status)],
        className,
      )}
    >
      {label ?? t(status)}
    </span>
  );
}
