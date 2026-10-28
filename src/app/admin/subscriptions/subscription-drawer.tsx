import { MessageCircle, SearchX } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { Drawer } from "@/components/admin/drawer";
import { StatusBadge } from "@/components/orders/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getAdminSubscription } from "@/lib/admin/subscription-queries";
import { addDays, baghdadToday, formatDay, formatDayTime } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";
import type { SubscriptionPlan } from "@/lib/subscriptions/queries";

import { SubscriptionActions } from "./subscription-actions";
import { SubscriptionStateBadge } from "./subscription-state-badge";

/**
 * The A7 drawer: the customer (tap to call, "افتح المحادثة"), the address,
 * the plan, period and visits, the orders on it (to A2), the actions for its
 * state and the internal notes.
 */
export async function SubscriptionDrawer({
  subscriptionId,
  closeHref,
  plan,
}: {
  subscriptionId: string;
  closeHref: string;
  plan: SubscriptionPlan;
}) {
  const t = await getTranslations("Admin.subscriptions");
  const tUI = await getTranslations("UI");
  const tLabels = await getTranslations("Location.labels");
  const subscription = await getAdminSubscription(subscriptionId);

  if (!subscription) {
    return (
      <Drawer title={t("drawer.notFound")} closeHref={closeHref}>
        <EmptyState
          icon={SearchX}
          title={t("drawer.notFound")}
          description={t("drawer.notFoundBody")}
        />
      </Drawer>
    );
  }

  const { customer, address } = subscription;
  const activated = subscription.startsOn !== null;
  const row = (label: string, value: ReactNode) => (
    <div className="flex flex-col gap-0.5">
      <dt className="text-13 text-muted">{label}</dt>
      <dd className="text-15 font-bold">{value}</dd>
    </div>
  );

  return (
    <Drawer
      closeHref={closeHref}
      title={
        <>
          {t("drawer.title", {
            name: customer.name ?? (customer.phone === null ? t("deletedAccount") : t("noName")),
          })}
          <SubscriptionStateBadge
            state={subscription.state}
            label={t(`states.${subscription.state}`)}
          />
        </>
      }
    >
      <Card className="flex flex-col gap-3.5 p-4">
        <dl className="flex flex-col gap-2.5">
          {row(
            t("drawer.customer"),
            <>
              {customer.name ?? (customer.phone === null ? t("deletedAccount") : t("noName"))}
              {customer.phone && (
                <a
                  href={`tel:${customer.phone}`}
                  dir="ltr"
                  className="block text-end text-14 font-bold text-teal"
                >
                  {formatPhone(customer.phone)}
                </a>
              )}
            </>,
          )}
          {row(
            t("drawer.address"),
            address ? (
              <>
                {t("address", { label: tLabels(address.label), district: address.district })}
                <span className="block text-14 font-normal text-muted">{address.landmark}</span>
              </>
            ) : (
              t("none")
            ),
          )}
          {activated &&
            row(
              t("drawer.plan"),
              t("drawer.planValue", {
                visits: subscription.visitsTotal,
                tanks: subscription.tanksCovered,
                price: tUI("iqd", { amount: formatIQD(subscription.priceIqd ?? 0) }),
              }),
            )}
          {subscription.startsOn &&
            subscription.endsOn &&
            row(
              t("drawer.period"),
              t("period", {
                from: formatDay(subscription.startsOn),
                to: formatDay(subscription.endsOn),
              }),
            )}
          {activated &&
            row(
              t("drawer.visits"),
              t("visitsValue", {
                used: subscription.visitsUsed,
                held: subscription.visitsHeld,
                left: subscription.visitsLeft,
                total: subscription.visitsTotal,
              }),
            )}
          {activated && row(t("columns.paid"), subscription.paid ? t("paid") : t("unpaid"))}
        </dl>
        <p className="text-13 text-muted">
          {t("drawer.requested", { date: formatDayTime(subscription.requestedAt) })}
        </p>
      </Card>

      {subscription.threadId && (
        <Button href={routes.adminChatThread(subscription.threadId)} size="md">
          <MessageCircle aria-hidden className="size-5" />
          {t("drawer.chat")}
        </Button>
      )}

      {/* No key: a refresh (another admin's change) keeps what is being typed. */}
      <SubscriptionActions
        subscriptionId={subscription.id}
        state={subscription.state}
        paid={subscription.paid}
        plan={{ visits: plan.visits, tanks: plan.tanks, priceIqd: plan.priceIqd }}
        today={baghdadToday()}
        // A renewal starts the day after the subscription it follows.
        defaultStart={
          subscription.runningUntil && subscription.runningUntil >= baghdadToday()
            ? addDays(subscription.runningUntil, 1)
            : baghdadToday()
        }
      />

      {activated && (
        <Card className="flex flex-col gap-2.5 p-4">
          <h2 className="text-16 font-extrabold">{t("drawer.orders")}</h2>
          {subscription.orders.length === 0 ? (
            <p className="text-14 text-muted">{t("drawer.noOrders")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {subscription.orders.map((order) => (
                <li key={order.id}>
                  <Link
                    href={routes.adminOrder(order.id)}
                    className="flex min-h-11 items-center gap-2 rounded-chip border border-border px-3 py-2 hover:bg-bg"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-14 font-bold text-teal">
                        {t.rich("drawer.orderLink", {
                          number: order.number,
                          num: (chunks) => <span dir="ltr">{chunks}</span>,
                        })}
                      </span>
                      <span className="text-12 text-muted">{formatDayTime(order.slotStartAt)}</span>
                    </span>
                    <StatusBadge status={order.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="flex flex-col gap-2.5 p-4">
        <h2 className="text-16 font-extrabold">{t("drawer.notes")}</h2>
        <p className="text-13 text-muted">{t("drawer.notesHint")}</p>
        {subscription.notes.length === 0 ? (
          <p className="text-14 text-muted">{t("drawer.noNotes")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {subscription.notes.map((note) => (
              <li key={note.id} className="flex flex-col gap-0.5 rounded-chip bg-bg px-3 py-2">
                <p className="text-15 whitespace-pre-line">{note.note}</p>
                <span className="text-12 text-muted">
                  {t("drawer.noteBy", {
                    name:
                      note.author?.full_name ??
                      (note.author ? formatPhone(note.author.phone) : t("drawer.anAdmin")),
                    at: formatDayTime(note.createdAt),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Drawer>
  );
}
