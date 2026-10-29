import { MessageCircle, SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { CustomerPanel } from "@/components/admin/customer-panel";
import { Drawer } from "@/components/admin/drawer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getAdminCustomer } from "@/lib/admin/customer-queries";
import { formatDate } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";

/**
 * The A6 customer drawer: the name, phone (tap to call), sign-up date and
 * number of orders, "افتح المحادثة" when they have written, then A4's
 * customer panel (latest orders, addresses, subscriptions, tickets).
 */
export async function CustomerDrawer({
  customerId,
  closeHref,
}: {
  customerId: string;
  closeHref: string;
}) {
  const t = await getTranslations("Admin.customers");
  const customer = await getAdminCustomer(customerId);

  if (!customer) {
    return (
      <Drawer title={t("drawer.notFound")} closeHref={closeHref}>
        <EmptyState
          icon={SearchX}
          title={t("drawer.notFound")}
          description={t("drawer.notFoundBody")}
          action={
            <Button href={routes.adminCustomers} variant="secondary" size="sm">
              {t("title")}
            </Button>
          }
        />
      </Drawer>
    );
  }

  const row = (label: string, value: ReactNode) => (
    <div className="flex flex-col gap-0.5">
      <dt className="text-13 text-muted">{label}</dt>
      <dd className="text-15 font-bold">{value}</dd>
    </div>
  );

  return (
    <Drawer closeHref={closeHref} title={customer.fullName ?? t("noName")}>
      <Card className="p-4">
        <dl className="grid grid-cols-2 gap-3.5">
          {row(
            t("drawer.phone"),
            <a
              href={`tel:${customer.phone}`}
              dir="ltr"
              className="inline-flex min-h-6 items-center text-teal"
            >
              {formatPhone(customer.phone)}
            </a>,
          )}
          {row(t("drawer.joined"), formatDate(customer.createdAt))}
          {row(t("drawer.orders"), customer.ordersCount)}
        </dl>
      </Card>
      {customer.threadId ? (
        <Button href={routes.adminChatThread(customer.threadId)} size="md">
          <MessageCircle aria-hidden className="size-5" />
          {t("drawer.chat")}
        </Button>
      ) : (
        <p className="text-14 text-muted">{t("drawer.noThread")}</p>
      )}
      <Card className="p-0">
        <CustomerPanel userId={customer.id} />
      </Card>
    </Drawer>
  );
}
