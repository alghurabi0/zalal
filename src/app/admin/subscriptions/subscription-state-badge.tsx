import { badgeToneClasses } from "@/components/orders/status-badge";
import { cn } from "@/lib/cn";
import type { SubscriptionState } from "@/lib/subscriptions/state";

const tone = {
  requested: "warn",
  upcoming: "info",
  active: "ok",
  expired: "neutral",
  declined: "neutral",
  cancelled: "neutral",
} as const satisfies Record<SubscriptionState, keyof typeof badgeToneClasses>;

/** A subscription's state pill (A7, A4): طلب جديد / فعّال / منتهي … */
export function SubscriptionStateBadge({
  state,
  label,
  className,
}: {
  state: SubscriptionState;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-10 px-2.5 py-0.5 text-12 font-extrabold whitespace-nowrap",
        badgeToneClasses[tone[state]],
        className,
      )}
    >
      {label}
    </span>
  );
}
