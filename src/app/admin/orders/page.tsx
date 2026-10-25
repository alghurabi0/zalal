import { CalendarRange, ListFilter, SearchX } from "lucide-react";
import Form from "next/form";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { OrderTable } from "@/components/admin/order-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import {
  ADMIN_ORDERS_PAGE,
  type AdminOrdersQuery,
  adminOrdersHref,
  parseAdminOrdersQuery,
  STATUS_FILTERS,
} from "@/lib/admin/orders-query";
import { type CrewOption, listAdminOrders, listCrews } from "@/lib/admin/queries";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";

import { OrderDrawer } from "./order-drawer";

/**
 * Orders (A2): the table with filters (status, date, district, crew) kept in
 * the URL, and the order drawer (`?order=`) over it.
 */
export default async function AdminOrdersPage(props: PageProps<"/admin/orders">) {
  const t = await getTranslations("Admin.orders");
  return (
    <AdminPage
      title={t("title")}
      actions={
        <Button href={routes.adminBoard} variant="secondary" size="sm">
          <CalendarRange aria-hidden className="size-4" />
          {t("toBoard")}
        </Button>
      }
    >
      <Suspense fallback={<OrdersSkeleton />}>
        <Orders {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Orders({ searchParams }: PageProps<"/admin/orders">) {
  await requireViewer(routes.adminOrders, "admin");
  const t = await getTranslations("Admin.orders");
  const query = parseAdminOrdersQuery(await searchParams);
  const [crews, { orders, more }] = await Promise.all([listCrews(), listAdminOrders(query)]);
  const filtered =
    query.status !== "active" || !!query.date || !!query.district || !!query.crew || !!query.slot;
  const listHref = (patch: Partial<AdminOrdersQuery>) => adminOrdersHref({ ...query, ...patch });

  return (
    <>
      <Filters
        // A fresh form when the URL changes (Next keeps the page alive).
        key={adminOrdersHref({ ...query, order: undefined, n: undefined })}
        query={query}
        crews={crews}
      />
      {query.slot && (
        <p className="flex flex-wrap items-center gap-2 text-14 text-muted">
          {t("slotFiltered")}
          <Button href={listHref({ slot: undefined, order: undefined })} variant="link" size="sm">
            {t("clearSlot")}
          </Button>
        </p>
      )}
      {orders.length === 0 ? (
        <Card className="py-6">
          <EmptyState
            icon={SearchX}
            title={filtered ? t("emptyFiltered") : t("empty")}
            description={filtered ? t("emptyFilteredBody") : t("emptyBody")}
            action={
              filtered ? (
                <Button href={routes.adminOrders} variant="secondary" size="sm">
                  {t("clear")}
                </Button>
              ) : (
                <Button href={routes.adminBoard} variant="secondary" size="sm">
                  {t("toBoard")}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <OrderTable
            orders={orders}
            hrefFor={(id) => listHref({ order: id })}
            caption={t("caption")}
          />
          {more && (
            <Button
              href={listHref({ n: query.n + ADMIN_ORDERS_PAGE, order: undefined })}
              variant="secondary"
              size="sm"
              scroll={false}
              className="self-center"
            >
              {t("more")}
            </Button>
          )}
        </>
      )}
      {query.order && (
        <Suspense key={query.order}>
          <OrderDrawer
            orderId={query.order}
            closeHref={listHref({ order: undefined })}
            crews={crews}
          />
        </Suspense>
      )}
    </>
  );
}

async function Filters({ query, crews }: { query: AdminOrdersQuery; crews: CrewOption[] }) {
  const t = await getTranslations("Admin.orders");
  const tStatus = await getTranslations("Orders.status");
  return (
    <Form
      action={routes.adminOrders}
      className="grid grid-cols-2 items-end gap-3 rounded-card border border-border bg-surface p-4 md:grid-cols-4"
    >
      <Field label={t("status")} variant="compact">
        {(control) => (
          <Select {...control} name="status" variant="compact" defaultValue={query.status}>
            {STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status === "active" || status === "booked" || status === "all"
                  ? t(`statuses.${status}`)
                  : tStatus(status)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t("date")} variant="compact">
        {(control) => (
          <Input
            {...control}
            type="date"
            name="date"
            variant="compact"
            dir="ltr"
            defaultValue={query.date ?? ""}
          />
        )}
      </Field>
      <Field label={t("district")} variant="compact">
        {(control) => (
          <Input
            {...control}
            type="search"
            name="district"
            variant="compact"
            maxLength={60}
            defaultValue={query.district ?? ""}
          />
        )}
      </Field>
      <Field label={t("crew")} variant="compact">
        {(control) => (
          <Select {...control} name="crew" variant="compact" defaultValue={query.crew ?? ""}>
            <option value="">{t("allCrews")}</option>
            <option value="none">{t("noCrew")}</option>
            {crews.map((crew) => (
              <option key={crew.id} value={crew.id}>
                {crew.active ? crew.name : t("inactiveCrew", { name: crew.name })}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {query.slot && <input type="hidden" name="slot" value={query.slot} />}
      <div className="col-span-full flex gap-2 md:justify-end">
        <Button type="submit" size="sm" className="flex-1 md:flex-none">
          <ListFilter aria-hidden className="size-4" />
          {t("apply")}
        </Button>
        <Button href={routes.adminOrders} variant="secondary" size="sm">
          {t("clear")}
        </Button>
      </div>
    </Form>
  );
}

function OrdersSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4">
      <Skeleton className="h-24 rounded-card" />
      <Skeleton className="h-96 rounded-card" />
    </SkeletonGroup>
  );
}
