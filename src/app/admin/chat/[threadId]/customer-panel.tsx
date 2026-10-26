import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { StatusBadge } from "@/components/orders/status-badge";
import { customerPanel } from "@/lib/admin/chat-queries";
import { ticketNumber } from "@/lib/certificates/format";
import { formatDayTime } from "@/lib/dates";
import { routes } from "@/lib/routes";

/**
 * A4's side panel (spec §8.2): the customer's latest orders (each opens the
 * A2 drawer), saved addresses, subscription (Phase 6) and tickets.
 */
export async function CustomerPanel({ userId }: { userId: string }) {
  const t = await getTranslations("Admin.chat.panel");
  const tLabels = await getTranslations("Location.labels");
  const { orders, addresses, tickets } = await customerPanel(userId);
  const num = (chunks: ReactNode) => <span dir="ltr">{chunks}</span>;

  return (
    <div className="flex flex-col gap-5 p-4">
      <h2 className="sr-only">{t("label")}</h2>
      <Section title={t("orders")}>
        {orders.length === 0 ? (
          <Muted>{t("noOrders")}</Muted>
        ) : (
          <ul className="flex flex-col gap-2">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={routes.adminOrder(order.id)}
                  className="flex min-h-11 items-center gap-2 rounded-chip border border-border px-3 py-2 hover:bg-bg"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-14 font-bold text-teal">
                      {t.rich("order", { number: order.number, num })}
                    </span>
                    <span className="text-12 text-muted">{formatDayTime(order.slot_start_at)}</span>
                  </span>
                  <StatusBadge status={order.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("addresses")}>
        {addresses.length === 0 ? (
          <Muted>{t("noAddresses")}</Muted>
        ) : (
          <ul className="flex flex-col gap-2">
            {addresses.map((address) => (
              <li key={address.id} className="flex flex-col text-14">
                <span className="font-bold">
                  {t("address", { label: tLabels(address.label), district: address.district })}
                </span>
                <span className="text-13 text-muted">{address.landmark}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("subscription")}>
        <Muted>{t("subscriptionLater")}</Muted>
      </Section>

      <Section title={t("tickets")}>
        {tickets.length === 0 ? (
          <Muted>{t("noTickets")}</Muted>
        ) : (
          <ul className="flex flex-col gap-2">
            {tickets.map((ticket) => {
              const label = ticket.order
                ? t.rich("ticketOrder", {
                    ticket: ticketNumber(ticket.number),
                    order: ticket.order.number,
                    num,
                  })
                : t.rich("ticket", { ticket: ticketNumber(ticket.number), num });
              return (
                <li key={ticket.id} className="flex items-center justify-between gap-2 text-14">
                  {ticket.order ? (
                    <Link
                      href={routes.adminOrder(ticket.order.id)}
                      className="font-bold text-teal underline-offset-4 hover:underline"
                    >
                      {label}
                    </Link>
                  ) : (
                    <span className="font-bold">{label}</span>
                  )}
                  <span className="text-12 text-muted">{t(`ticketStatus.${ticket.status}`)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-14 font-extrabold text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-13 text-muted">{children}</p>;
}
