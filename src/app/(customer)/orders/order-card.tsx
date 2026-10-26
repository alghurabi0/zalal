import Link from "next/link";
import { useTranslations } from "next-intl";

import { GroundTankIcon, RoofTankIcon } from "@/components/icons/tank-icons";
import { StatusBadge } from "@/components/orders/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate, serviceDayParts, slotParts } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import type { OrderLine, OrderSummary } from "@/lib/orders/queries";
import { ordersTab, primaryAction } from "@/lib/orders/status";
import { routes } from "@/lib/routes";

const typeIcons = { roof: RoofTankIcon, ground: GroundTankIcon } as const;

/**
 * One order on Orders (Orders.dc.html, spec §5.12): number and date,
 * status, tanks, address, price and the button for its status. The whole
 * card opens Order details (N4). مساعدة comes with Chat (Phase 5).
 */
export function OrderCard({ order }: { order: OrderSummary }) {
  const t = useTranslations("Orders");
  const tBooking = useTranslations("Booking");
  const tLabels = useTranslations("Location.labels");
  const Icon = typeIcons[order.lines[0]?.tank_type ?? "roof"];
  const action = primaryAction(order.status);

  const { weekday, day } = serviceDayParts(order.service_date);
  const date =
    ordersTab(order.status) === "current"
      ? t("when", {
          weekday,
          day,
          slot: tBooking("slot", slotParts(order.slot_start_at, order.slot_end_at)),
        })
      : formatDate(order.slot_start_at);

  return (
    <Card className="relative flex flex-col gap-2.5 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={routes.order(order.id)}
          className="text-13 text-muted outline-none after:absolute after:inset-0 after:rounded-card focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-teal"
        >
          {t.rich("number", {
            number: order.number,
            date,
            num: (chunks) => <span dir="ltr">{chunks}</span>,
          })}
        </Link>
        <StatusBadge status={order.status} />
      </div>
      <div className="flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-input bg-selected text-teal">
          <Icon className="size-6" strokeWidth={2} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-15 font-extrabold">
            <TanksText lines={order.lines} />
          </span>
          <span className="truncate text-13 text-muted">
            {order.label
              ? t("where", { label: tLabels(order.label), district: order.district })
              : order.district}
          </span>
        </span>
        <span className="text-15 font-black" dir="ltr">
          {formatIQD(order.total_iqd)}
        </span>
      </div>
      <div className="relative z-10 flex gap-2">
        {action === "rebook" ? (
          <Button href={routes.book} size="sm" className="flex-1 text-14">
            {t("rebook")}
          </Button>
        ) : action === "track" ? (
          <Button href={routes.tracking(order.id)} size="sm" className="flex-1 text-14">
            {t("track")}
          </Button>
        ) : action === "progress" ? (
          <Button href={routes.jobProgress(order.id)} size="sm" className="flex-1 text-14">
            {t("progress")}
          </Button>
        ) : (
          <Button href={routes.order(order.id)} size="sm" className="flex-1 text-14">
            {t("details")}
          </Button>
        )}
      </div>
    </Card>
  );
}

/** "خزان سطح · 1,000–2,000", "خزان سطح × 2", or "3 خزانات" for mixed lines. */
export function TanksText({ lines }: { lines: OrderLine[] }) {
  const t = useTranslations("Orders");
  const tTanks = useTranslations("Tanks");
  const [first] = lines;
  if (!first) return null;
  if (lines.length > 1) {
    return t("tanksMany", { count: lines.reduce((sum, line) => sum + line.qty, 0) });
  }
  const type = tTanks(`types.${first.tank_type}`);
  return first.qty > 1
    ? t("tankQty", { type, qty: first.qty })
    : t("tankOne", {
        type,
        size: tTanks(`sizes.${first.size}`),
      });
}
