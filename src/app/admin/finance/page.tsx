import { ArrowLeftRight, HandCoins, SearchX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Drawer } from "@/components/admin/drawer";
import { AdminPage } from "@/components/admin/admin-page";
import { accountName, FinanceTabs, Money, MonthPicker } from "@/components/admin/finance";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { addMonthsTo } from "@/lib/admin/calendar";
import {
  type FinanceAccount,
  financeAccounts,
  financeStartOn,
  getTransfer,
  listTransfers,
  type Transfer,
} from "@/lib/admin/finance-queries";
import {
  type AdminBoxesQuery,
  adminBoxesHref,
  parseAdminBoxesQuery,
} from "@/lib/admin/finance-query";
import { requireViewer } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { baghdadToday, formatDay } from "@/lib/dates";
import { routes } from "@/lib/routes";

import { TransferForm } from "./transfer-form";

/**
 * Boxes (A15, spec §8.3): every money box with its balance (a warning below
 * zero), "استلم المبلغ" on a crew box holding cash, and the month's
 * transfers. `?transfer=new|<id>` opens the drawer; `&from=` fills a crew's
 * handover.
 */
export default async function FinanceBoxesPage(props: PageProps<"/admin/finance">) {
  const t = await getTranslations("Admin.finance.boxes");
  return (
    <AdminPage title={t("title")}>
      <FinanceTabs current="boxes" />
      <Suspense fallback={<BoxesSkeleton />}>
        <Boxes {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Boxes({ searchParams }: PageProps<"/admin/finance">) {
  await requireViewer(routes.adminFinance, "admin");
  const t = await getTranslations("Admin.finance");
  const query = parseAdminBoxesQuery(await searchParams);
  const today = baghdadToday();
  const thisMonth = today.slice(0, 7);
  const month = query.month && query.month <= thisMonth ? query.month : thisMonth;
  const [accounts, transfers] = await Promise.all([financeAccounts(), listTransfers(month)]);
  const hrefFor = (patch: Partial<AdminBoxesQuery>) =>
    adminBoxesHref({ month: query.month, ...patch });
  const nameOf = new Map(
    accounts.map((account) => [account.id, accountName(account, (crew) => t("crewBox", { crew }))]),
  );
  const active = accounts.filter((account) => account.active);
  const off = accounts.filter((account) => !account.active);
  const total = accounts.reduce((sum, account) => sum + account.balanceIqd, 0);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-15 text-body-2">
          {t("boxes.total")} <Money amount={total} className="text-18 font-black text-navy" />
        </p>
        <Button href={hrefFor({ transfer: "new" })} size="sm" scroll={false}>
          <ArrowLeftRight aria-hidden className="size-4" />
          {t("boxes.newTransfer")}
        </Button>
      </div>

      <h2 className="sr-only">{t("boxes.balancesTitle")}</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((account) => (
          <li key={account.id}>
            <BoxCard
              account={account}
              name={nameOf.get(account.id) ?? ""}
              handoverHref={hrefFor({ transfer: "new", from: account.id })}
            />
          </li>
        ))}
      </ul>
      {off.length > 0 && (
        <section aria-labelledby="boxes-off" className="flex flex-col gap-2">
          <h2 id="boxes-off" className="text-16 font-extrabold">
            {t("boxes.offTitle")}
          </h2>
          <ul className="flex flex-col divide-y divide-divider rounded-card border border-border bg-surface">
            {off.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-muted">{nameOf.get(account.id)}</span>
                <Money amount={account.balanceIqd} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="transfers" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="transfers" className="text-20 font-black">
            {t("boxes.transfersTitle")}
          </h2>
          <MonthPicker
            month={month}
            prevHref={adminBoxesHref({ month: addMonthsTo(month, -1) })}
            nextHref={month < thisMonth ? adminBoxesHref({ month: addMonthsTo(month, 1) }) : null}
          />
        </div>
        {transfers.length === 0 ? (
          <Card className="py-6">
            <EmptyState
              icon={ArrowLeftRight}
              title={t("boxes.emptyTitle")}
              description={t("boxes.emptyBody")}
              action={
                <Button href={hrefFor({ transfer: "new" })} size="sm" scroll={false}>
                  {t("boxes.newTransfer")}
                </Button>
              }
            />
          </Card>
        ) : (
          <TransferTable transfers={transfers} nameOf={nameOf} hrefFor={hrefFor} />
        )}
      </section>

      {query.transfer && (
        <Suspense key={`${query.transfer}-${query.from ?? ""}`}>
          <TransferDrawer
            query={query}
            accounts={accounts}
            nameOf={nameOf}
            today={today}
            closeHref={hrefFor({})}
          />
        </Suspense>
      )}
    </>
  );
}

async function BoxCard({
  account,
  name,
  handoverHref,
}: {
  account: FinanceAccount;
  name: string;
  handoverHref: string;
}) {
  const t = await getTranslations("Admin.finance");
  const holding = account.kind === "crew" && account.balanceIqd > 0;
  return (
    <Card className="flex h-full flex-col gap-2 p-4" data-testid={`box-${account.id}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-16 font-extrabold">{name}</h3>
        <span className="rounded-10 bg-well px-2 py-0.5 text-12 font-bold text-muted">
          {t(`kinds.${account.kind}`)}
        </span>
      </div>
      <Money amount={account.balanceIqd} className="text-24 font-black" />
      {account.balanceIqd < 0 && (
        <p className="flex items-start gap-1.5 text-13 font-bold text-warn-fg">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("boxes.negative")}
        </p>
      )}
      {holding && (
        <Button
          href={handoverHref}
          size="sm"
          variant="secondary"
          scroll={false}
          className="mt-auto self-start"
        >
          <HandCoins aria-hidden className="size-4" />
          {t("boxes.handover")}
          <span className="sr-only"> {name}</span>
        </Button>
      )}
    </Card>
  );
}

async function TransferTable({
  transfers,
  nameOf,
  hrefFor,
}: {
  transfers: Transfer[];
  nameOf: Map<string, string>;
  hrefFor: (patch: Partial<AdminBoxesQuery>) => string;
}) {
  const t = await getTranslations("Admin.finance");
  const columns = ["date", "from", "to", "amount", "note"] as const;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-3xl text-14">
        <caption className="sr-only">{t("boxes.transfersTitle")}</caption>
        <thead className="bg-well text-13 text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2.5 text-start font-bold">
                {t(`boxes.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transfers.map((transfer) => {
            const voided = transfer.voidedAt !== null;
            return (
              <tr
                key={transfer.id}
                className={cn("border-t border-divider align-top", voided && "text-muted")}
              >
                <td className="p-0">
                  <Link
                    href={hrefFor({ transfer: transfer.id })}
                    scroll={false}
                    className="flex min-h-11 items-center px-3 font-extrabold whitespace-nowrap text-teal underline-offset-2 hover:underline"
                  >
                    {formatDay(transfer.movedOn)}
                    <span className="sr-only"> {t("boxes.openTransfer")}</span>
                  </Link>
                </td>
                <td className="px-3 py-3">{nameOf.get(transfer.fromAccountId)}</td>
                <td className="px-3 py-3">{nameOf.get(transfer.toAccountId)}</td>
                <td className="px-3 py-3">
                  <Money amount={transfer.amountIqd} className={cn(voided && "line-through")} />
                  {voided && (
                    <span className="ms-2 rounded-10 bg-well px-2 py-0.5 text-12 font-bold">
                      {t("voided")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">{transfer.note ?? t("none")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function TransferDrawer({
  query,
  accounts,
  nameOf,
  today,
  closeHref,
}: {
  query: AdminBoxesQuery;
  accounts: FinanceAccount[];
  nameOf: Map<string, string>;
  today: string;
  closeHref: string;
}) {
  const t = await getTranslations("Admin.finance");
  const isNew = query.transfer === "new";
  const [transfer, startOn] = await Promise.all([
    isNew || !query.transfer ? null : getTransfer(query.transfer),
    financeStartOn(),
  ]);

  if (!isNew && !transfer) {
    return (
      <Drawer title={t("transfer.notFound")} closeHref={closeHref}>
        <EmptyState icon={SearchX} title={t("transfer.notFound")} description={t("notFoundBody")} />
      </Drawer>
    );
  }

  // A switched-off box can't hand anything over (the form wouldn't list it).
  const from =
    isNew && query.from ? accounts.find((a) => a.id === query.from && a.active) : undefined;
  const cash = accounts.find((a) => a.kind === "cash" && a.active);
  const options = accounts.map((account) => ({
    id: account.id,
    label: nameOf.get(account.id) ?? "",
    active: account.active,
  }));

  return (
    <Drawer
      closeHref={closeHref}
      title={
        transfer
          ? t("transfer.editTitle")
          : from
            ? t("transfer.handoverTitle", { name: nameOf.get(from.id) ?? "" })
            : t("transfer.newTitle")
      }
    >
      <TransferForm
        key={transfer?.id ?? `new-${from?.id ?? ""}`}
        transfer={transfer}
        accounts={options}
        defaults={{
          fromAccountId: from?.id ?? "",
          toAccountId: from && cash && cash.id !== from.id ? cash.id : "",
          amount: from && from.balanceIqd > 0 ? from.balanceIqd : null,
        }}
        today={today}
        startOn={startOn}
        closeHref={closeHref}
      />
    </Drawer>
  );
}

function BoxesSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4">
      <Skeleton className="h-11 w-72" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-32 rounded-card" />
        <Skeleton className="h-32 rounded-card" />
        <Skeleton className="h-32 rounded-card" />
      </div>
      <Skeleton className="h-64 rounded-card" />
    </SkeletonGroup>
  );
}
