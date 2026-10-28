import Link from "next/link";
import { useTranslations } from "next-intl";

import { StatusBadge } from "@/components/orders/status-badge";
import type { AdminOrderRow } from "@/lib/admin/queries";
import { serviceDayParts, slotParts } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { formatPhone } from "@/lib/phone";

/**
 * Orders as a table (A1's pending list, A2). The order number opens the
 * drawer; `hrefFor` keeps the page's filters in that link.
 */
export function OrderTable({
  orders,
  hrefFor,
  caption,
}: {
  orders: AdminOrderRow[];
  hrefFor: (id: string) => string;
  caption: string;
}) {
  const t = useTranslations("Admin.table");
  const tBooking = useTranslations("Booking");
  const tUI = useTranslations("UI");

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-3xl text-start text-14">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-well text-13 text-muted">
          <tr>
            {(
              [
                "number",
                "when",
                "customer",
                "district",
                "tanks",
                "total",
                "crew",
                "status",
              ] as const
            ).map((column) => (
              <th key={column} scope="col" className="px-3 py-2.5 text-start font-bold">
                {t(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const { weekday, day } = serviceDayParts(order.service_date);
            return (
              <tr key={order.id} className="border-t border-divider align-top">
                <td className="p-0">
                  <Link
                    href={hrefFor(order.id)}
                    scroll={false}
                    className="flex min-h-11 items-center px-3 font-extrabold text-teal underline-offset-2 hover:underline"
                    aria-label={t("open", { number: order.number })}
                  >
                    <span dir="ltr">#{order.number}</span>
                  </Link>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className="block font-bold">{t("day", { weekday, day })}</span>
                  <span className="text-13 text-muted">
                    {tBooking("slot", slotParts(order.slot_start_at, order.slot_end_at))}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="block font-bold">
                    {order.customer?.full_name ??
                      (order.customer && order.customer.phone === null
                        ? t("deletedAccount")
                        : t("noName"))}
                  </span>
                  {order.customer && (
                    <span dir="ltr" className="text-13 text-muted">
                      {formatPhone(order.customer.phone)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">{order.district}</td>
                <td className="px-3 py-2.5">{order.tanks}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {order.subscription_id ? (
                    <span className="font-bold text-ok-fg">{tUI("covered")}</span>
                  ) : (
                    tUI("iqd", { amount: formatIQD(order.total_iqd) })
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {order.crew?.name ?? <span className="text-muted">{t("noCrew")}</span>}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={order.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
