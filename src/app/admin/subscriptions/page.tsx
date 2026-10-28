import { ListFilter, Repeat } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { listAdminSubscriptions } from "@/lib/admin/subscription-queries";
import {
  ADMIN_SUBSCRIPTIONS_PAGE,
  type AdminSubscriptionsQuery,
  adminSubscriptionsHref,
  parseAdminSubscriptionsQuery,
  SUBSCRIPTION_VIEWS,
} from "@/lib/admin/subscriptions-query";
import { requireViewer } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { formatDay, formatDayTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";
import { subscriptionPlan } from "@/lib/subscriptions/queries";
import type { Subscription } from "@/lib/subscriptions/state";

import { SubscriptionDrawer } from "./subscription-drawer";
import { SubscriptionStateBadge } from "./subscription-state-badge";

/**
 * Subscriptions (A7, spec §8.2): the request queue (oldest first, the
 * default), running subscriptions, those ending within 30 days, and the
 * ended, declined and cancelled ones; a search by name or phone. The view,
 * search and drawer (`?subscription=`) are in the URL. The drawer activates
 * a request, ticks paid, adjusts visits, declines or cancels, and keeps
 * internal notes. Live through the shell's LiveSubscriptions.
 */
export default async function AdminSubscriptionsPage(props: PageProps<"/admin/subscriptions">) {
  const t = await getTranslations("Admin.subscriptions");
  return (
    <AdminPage title={t("title")}>
      <Suspense fallback={<SubscriptionsSkeleton />}>
        <Subscriptions {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Subscriptions({ searchParams }: PageProps<"/admin/subscriptions">) {
  await requireViewer(routes.adminSubscriptions, "admin");
  const t = await getTranslations("Admin.subscriptions");
  const query = parseAdminSubscriptionsQuery(await searchParams);
  const [{ subscriptions, more }, plan] = await Promise.all([
    listAdminSubscriptions(query),
    subscriptionPlan(),
  ]);
  const listHref = (patch: Partial<AdminSubscriptionsQuery>) =>
    adminSubscriptionsHref({ ...query, ...patch });

  return (
    <>
      <nav aria-label={t("view")} className="flex flex-wrap gap-2">
        {SUBSCRIPTION_VIEWS.map((view) => {
          const on = view === query.view;
          return (
            <Link
              key={view}
              href={adminSubscriptionsHref({ view, q: query.q })}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center rounded-full border-2 px-4 text-14 font-bold",
                on ? "border-navy bg-navy text-white" : "border-border bg-surface text-muted",
              )}
            >
              {t(`views.${view}`)}
            </Link>
          );
        })}
      </nav>
      <Form
        // A fresh form when the URL changes (Next keeps the page alive).
        key={query.q ?? ""}
        action={routes.adminSubscriptions}
        className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-4"
      >
        {query.view !== "requests" && <input type="hidden" name="view" value={query.view} />}
        <Field label={t("search")} variant="compact" className="min-w-60 flex-1">
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
        <Button type="submit" size="sm">
          <ListFilter aria-hidden className="size-4" />
          {t("apply")}
        </Button>
        {query.q && (
          <Button href={adminSubscriptionsHref({ view: query.view })} variant="secondary" size="sm">
            {t("clear")}
          </Button>
        )}
      </Form>

      {subscriptions.length === 0 ? (
        <Card className="py-6">
          <EmptyState
            icon={Repeat}
            title={query.q ? t("emptyFiltered") : t(`empty.${query.view}`)}
            description={query.q ? undefined : t("emptyBody")}
          />
        </Card>
      ) : (
        <>
          <SubscriptionTable
            subscriptions={subscriptions}
            hrefFor={(id) => listHref({ subscription: id })}
          />
          {more && (
            <Button
              href={listHref({ n: query.n + ADMIN_SUBSCRIPTIONS_PAGE, subscription: undefined })}
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
      {query.subscription && (
        <Suspense key={query.subscription}>
          <SubscriptionDrawer
            subscriptionId={query.subscription}
            closeHref={listHref({ subscription: undefined })}
            plan={plan}
          />
        </Suspense>
      )}
    </>
  );
}

async function SubscriptionTable({
  subscriptions,
  hrefFor,
}: {
  subscriptions: Subscription[];
  hrefFor: (id: string) => string;
}) {
  const t = await getTranslations("Admin.subscriptions");
  const tLabels = await getTranslations("Location.labels");
  const columns = [
    "customer",
    "address",
    "state",
    "period",
    "visits",
    "paid",
    "requested",
  ] as const;

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-4xl text-start text-14">
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
          {subscriptions.map((subscription) => {
            const activated = subscription.startsOn !== null;
            return (
              <tr key={subscription.id} className="border-t border-divider align-top">
                <td className="p-0">
                  <Link
                    href={hrefFor(subscription.id)}
                    scroll={false}
                    className="flex min-h-11 flex-col justify-center px-3 py-2 underline-offset-2 hover:underline"
                  >
                    <span className="font-extrabold text-teal">
                      {subscription.customer.name ??
                        (subscription.customer.phone === null ? t("deletedAccount") : t("noName"))}
                    </span>
                    {subscription.customer.phone && (
                      <span dir="ltr" className="text-end text-13 text-muted">
                        {formatPhone(subscription.customer.phone)}
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-3 py-3">
                  {subscription.address
                    ? t("address", {
                        label: tLabels(subscription.address.label),
                        district: subscription.address.district,
                      })
                    : t("none")}
                </td>
                <td className="px-3 py-3">
                  <SubscriptionStateBadge
                    state={subscription.state}
                    label={t(`states.${subscription.state}`)}
                  />
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {subscription.startsOn && subscription.endsOn
                    ? t("period", {
                        from: formatDay(subscription.startsOn),
                        to: formatDay(subscription.endsOn),
                      })
                    : t("none")}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {activated
                    ? t("visitsShort", {
                        left: subscription.visitsLeft,
                        total: subscription.visitsTotal,
                      })
                    : t("none")}
                </td>
                <td className="px-3 py-3">
                  {activated ? (subscription.paid ? t("paid") : t("unpaid")) : t("none")}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {formatDayTime(subscription.requestedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SubscriptionsSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4">
      <Skeleton className="h-11 w-96" />
      <Skeleton className="h-20 rounded-card" />
      <Skeleton className="h-96 rounded-card" />
    </SkeletonGroup>
  );
}
