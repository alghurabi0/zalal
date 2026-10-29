import { ListFilter, SearchX, UsersRound } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { type AdminCustomerRow, listAdminCustomers } from "@/lib/admin/customer-queries";
import {
  ADMIN_CUSTOMERS_PAGE,
  type AdminCustomersQuery,
  adminCustomersHref,
  CUSTOMER_SORTS,
  parseAdminCustomersQuery,
} from "@/lib/admin/customers-query";
import { requireViewer } from "@/lib/auth/viewer";
import { formatDate } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";

import { CustomerDrawer } from "./customer-drawer";

/**
 * Customers (A6, spec §8.2): every live customer account, booked or not,
 * with how many orders each made, newest sign-up first or most orders
 * first, and a search by name or phone, all in the URL. The drawer
 * (`?customer=`) shows the customer's orders, addresses, subscriptions and
 * tickets.
 */
export default async function AdminCustomersPage(props: PageProps<"/admin/customers">) {
  const t = await getTranslations("Admin.customers");
  return (
    <AdminPage title={t("title")}>
      <Suspense fallback={<CustomersSkeleton />}>
        <Customers {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Customers({ searchParams }: PageProps<"/admin/customers">) {
  await requireViewer(routes.adminCustomers, "admin");
  const t = await getTranslations("Admin.customers");
  const query = parseAdminCustomersQuery(await searchParams);
  const { customers, total, more } = await listAdminCustomers(query);
  const listHref = (patch: Partial<AdminCustomersQuery>) =>
    adminCustomersHref({ ...query, ...patch });

  return (
    <>
      <Filters
        // A fresh form when the URL changes (Next keeps the page alive).
        key={adminCustomersHref({ ...query, customer: undefined, n: undefined })}
        query={query}
      />
      {customers.length === 0 ? (
        <Card className="py-6">
          <EmptyState
            icon={query.q ? SearchX : UsersRound}
            title={query.q ? t("emptyFiltered") : t("empty")}
            description={query.q ? t("emptyFilteredBody") : t("emptyBody")}
            action={
              query.q && (
                <Button href={routes.adminCustomers} variant="secondary" size="sm">
                  {t("clear")}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <p className="text-14 font-bold text-muted" aria-live="polite">
            {t("count", { count: total })}
          </p>
          <CustomerTable customers={customers} hrefFor={(id) => listHref({ customer: id })} />
          {more && (
            <Button
              href={listHref({ n: query.n + ADMIN_CUSTOMERS_PAGE, customer: undefined })}
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
      {query.customer && (
        <Suspense key={query.customer}>
          <CustomerDrawer
            customerId={query.customer}
            closeHref={listHref({ customer: undefined })}
          />
        </Suspense>
      )}
    </>
  );
}

async function Filters({ query }: { query: AdminCustomersQuery }) {
  const t = await getTranslations("Admin.customers");
  return (
    <Form
      action={routes.adminCustomers}
      className="grid grid-cols-2 items-end gap-3 rounded-card border border-border bg-surface p-4 md:grid-cols-4"
    >
      <Field label={t("search")} variant="compact" className="col-span-2">
        {(control) => (
          <Input
            {...control}
            type="search"
            name="q"
            variant="compact"
            maxLength={60}
            defaultValue={query.q ?? ""}
          />
        )}
      </Field>
      <Field label={t("sort")} variant="compact" className="col-span-2 md:col-span-1">
        {(control) => (
          <Select {...control} name="sort" variant="compact" defaultValue={query.sort}>
            {CUSTOMER_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {t(`sorts.${sort}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="col-span-2 flex gap-2 md:col-span-1 md:justify-end">
        <Button type="submit" size="sm" className="flex-1 md:flex-none">
          <ListFilter aria-hidden className="size-4" />
          {t("apply")}
        </Button>
        <Button href={routes.adminCustomers} variant="secondary" size="sm">
          {t("clear")}
        </Button>
      </div>
    </Form>
  );
}

async function CustomerTable({
  customers,
  hrefFor,
}: {
  customers: AdminCustomerRow[];
  hrefFor: (id: string) => string;
}) {
  const t = await getTranslations("Admin.customers");
  const columns = ["customer", "joined", "orders", "lastOrder", "district"] as const;

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-3xl text-start text-14">
        <caption className="sr-only">{t("caption")}</caption>
        <thead className="bg-well text-13 text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2.5 text-start font-bold">
                {t(`columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {customers.map((customer) => (
            <tr key={customer.id} className="border-t border-divider align-top">
              <td className="p-0">
                <Link
                  href={hrefFor(customer.id)}
                  scroll={false}
                  className="flex min-h-11 flex-col justify-center px-3 py-2 underline-offset-2 hover:underline"
                >
                  <span className="font-extrabold text-teal">
                    {customer.full_name ?? t("noName")}
                  </span>
                  <span dir="ltr" className="text-end text-13 text-muted">
                    {formatPhone(customer.phone)}
                  </span>
                </Link>
              </td>
              <td className="px-3 py-3 whitespace-nowrap">{formatDate(customer.created_at)}</td>
              <td className="px-3 py-3 font-extrabold">{customer.orders_count}</td>
              <td className="px-3 py-3 whitespace-nowrap">
                {customer.last_order_at ? formatDate(customer.last_order_at) : t("none")}
              </td>
              <td className="px-3 py-3">{customer.district ?? t("none")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomersSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4">
      <Skeleton className="h-24 rounded-card" />
      <Skeleton className="h-96 rounded-card" />
    </SkeletonGroup>
  );
}
