import { ClipboardList, History } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Screen } from "@/components/layout/screen";
import { LiveOrders } from "@/components/orders/live-orders";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { CustomerTabBar } from "@/components/chat/customer-tab-bar";
import { requireViewer } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { listOrders } from "@/lib/orders/queries";
import type { OrdersTab } from "@/lib/orders/status";
import { routes } from "@/lib/routes";
import { ORDERS_MAX, ORDERS_PAGE, ordersQuerySchema } from "@/lib/schemas/order";

import { OrderCard } from "./order-card";

/**
 * Orders (Orders.dc.html, spec §5.12): الحالية and السابقة, 20 at a time,
 * live while open. The tab is in the URL (`?tab=past`), so going back keeps it.
 */
export default async function OrdersPage(props: PageProps<"/orders">) {
  const t = await getTranslations("Orders");
  return (
    <Screen className="bg-bg">
      <div className="flex flex-1 flex-col">
        <h1 id="orders-title" className="px-5 pt-5.5 pb-3.5 text-24 font-black">
          {t("title")}
        </h1>
        <Suspense fallback={<OrdersSkeleton />}>
          <OrdersContent {...props} />
        </Suspense>
      </div>
      <CustomerTabBar active="orders" />
    </Screen>
  );
}

async function OrdersContent({ searchParams }: PageProps<"/orders">) {
  const query = ordersQuerySchema.parse(await searchParams);
  const viewer = await requireViewer(
    query.tab === "past" ? `${routes.orders}?tab=past` : routes.orders,
  );
  const t = await getTranslations("Orders");
  const { orders, more } = await listOrders(query.tab, query.n);

  return (
    <>
      <LiveOrders customerId={viewer.id} />
      <div className="px-5 pb-3">
        <Tabs active={query.tab} />
      </div>
      <div className="flex flex-col gap-2.5 px-4 pb-6">
        {orders.length === 0 ? (
          <EmptyOrders tab={query.tab} />
        ) : (
          <ul aria-labelledby="orders-title" className="flex flex-col gap-2.5">
            {orders.map((order) => (
              <li key={order.id}>
                <OrderCard order={order} />
              </li>
            ))}
          </ul>
        )}
        {more && query.n < ORDERS_MAX && (
          <Button
            href={ordersHref(query.tab, query.n + ORDERS_PAGE)}
            variant="secondary"
            size="sm"
            scroll={false}
            replace
            className="self-center"
          >
            {t("more")}
          </Button>
        )}
      </div>
    </>
  );
}

function ordersHref(tab: OrdersTab, n?: number) {
  const params = new URLSearchParams();
  if (tab === "past") params.set("tab", "past");
  if (n) params.set("n", String(n));
  const query = params.toString();
  return query ? `${routes.orders}?${query}` : routes.orders;
}

/** The segmented control from the design. Links, so each tab has a URL. */
async function Tabs({ active }: { active: OrdersTab }) {
  const t = await getTranslations("Orders.tabs");
  return (
    <nav aria-label={t("label")}>
      <ul className="grid grid-cols-2 rounded-input bg-border p-1">
        {(["current", "past"] as const).map((tab) => (
          <li key={tab}>
            <Link
              href={ordersHref(tab)}
              replace
              aria-current={tab === active ? "page" : undefined}
              className={cn(
                "flex h-10 items-center justify-center rounded-10 text-14 font-extrabold",
                tab === active ? "bg-surface text-navy shadow-segment" : "text-muted",
              )}
            >
              {t(tab)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

async function EmptyOrders({ tab }: { tab: OrdersTab }) {
  const t = await getTranslations("Orders");
  return (
    <EmptyState
      icon={tab === "current" ? ClipboardList : History}
      title={tab === "current" ? t("emptyCurrentTitle") : t("emptyPastTitle")}
      description={tab === "current" ? t("emptyCurrentBody") : t("emptyPastBody")}
      action={
        <Button href={routes.book} size="footer" className="w-full">
          {t("book")}
        </Button>
      }
    />
  );
}

function OrdersSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-2.5 px-4">
      <Skeleton className="mx-1 mb-1 h-12 rounded-input" />
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-44 rounded-card" />
      ))}
    </SkeletonGroup>
  );
}
