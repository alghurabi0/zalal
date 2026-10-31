import { CheckCircle2, Plus, Scale, SearchX, TriangleAlert, Users, Wrench } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { Drawer } from "@/components/admin/drawer";
import {
  accountName,
  ClosedBadge,
  FinanceTabs,
  Money,
  MonthPicker,
} from "@/components/admin/finance";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { addMonthsTo } from "@/lib/admin/calendar";
import { financeAccounts, financeBooks } from "@/lib/admin/finance-queries";
import {
  type AdminPartnersQuery,
  adminExpensesHref,
  adminPartnersHref,
  parseAdminPartnersQuery,
} from "@/lib/admin/finance-query";
import { type FinanceBooks, firstOpenDay, isClosed } from "@/lib/admin/finance-reports";
import {
  balanceSheet,
  type BalanceSheet,
  equipment,
  type EquipmentItem,
  getOpeningEquipment,
  liveDisposal,
  partnerBalances,
  type PartnerBalance,
  partnerMovements,
  shareSets,
} from "@/lib/admin/partner-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { baghdadToday, formatDay } from "@/lib/dates";
import { routes } from "@/lib/routes";
import { formatShare } from "@/lib/schemas/finance";

import {
  DisposalSection,
  MovementSection,
  OpeningEquipmentForm,
  PartnerForm,
  SharesForm,
} from "./partner-forms";

/**
 * Partners and the balance sheet (A22, spec §8.3; Phase 7, task 5): the
 * balance sheet at the month's end (today for this month), each partner's
 * share, capital, withdrawals, profit share and balance, and the equipment
 * spread over its life. `?partner=`, `?shares=1` and `?equipment=` open
 * drawers.
 */
export default async function PartnersPage(props: PageProps<"/admin/finance/partners">) {
  const t = await getTranslations("Admin.finance.partners");
  return (
    <AdminPage title={t("title")}>
      <FinanceTabs current="partners" />
      <Suspense fallback={<PartnersSkeleton />}>
        <Partners {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Partners({ searchParams }: PageProps<"/admin/finance/partners">) {
  await requireViewer(routes.adminPartners, "admin");
  const t = await getTranslations("Admin.finance");
  const query = parseAdminPartnersQuery(await searchParams);
  const today = baghdadToday();
  const thisMonth = today.slice(0, 7);
  const books = await financeBooks();
  const firstMonth = books.startOn.slice(0, 7);
  const asked = query.month && query.month <= thisMonth ? query.month : thisMonth;
  const month = asked < firstMonth ? firstMonth : asked;
  const [sheet, balances, items] = await Promise.all([
    balanceSheet(month),
    partnerBalances(month),
    equipment(month),
  ]);
  const hrefFor = (patch: Partial<AdminPartnersQuery>) =>
    adminPartnersHref({ month: query.month, ...patch });
  const shown = balances.partners.filter(
    (row) => row.partner.active || row.balanceIqd !== 0 || row.profitMonthIqd !== 0,
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker
          month={month}
          prevHref={month > firstMonth ? hrefFor({ month: addMonthsTo(month, -1) }) : null}
          nextHref={month < thisMonth ? hrefFor({ month: addMonthsTo(month, 1) }) : null}
        />
        {isClosed(books, month) && <ClosedBadge />}
      </div>

      <BalanceSheetCard sheet={sheet} today={today} />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-18 font-extrabold">{t("partners.partnersTitle")}</h2>
          <div className="flex flex-wrap gap-2">
            <Button href={hrefFor({ shares: "1" })} size="sm" variant="secondary" scroll={false}>
              <Scale aria-hidden className="size-4" />
              {t("partners.sharesButton")}
            </Button>
            <Button href={hrefFor({ partner: "new" })} size="sm" scroll={false}>
              <Plus aria-hidden className="size-4" />
              {t("partners.newPartner")}
            </Button>
          </div>
        </div>
        {balances.partners.length === 0 ? (
          <Card className="py-6">
            <EmptyState
              icon={Users}
              title={t("partners.emptyTitle")}
              description={t("partners.emptyBody")}
              action={
                <Button href={hrefFor({ partner: "new" })} size="sm" scroll={false}>
                  {t("partners.firstPartner")}
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            {shown.every((row) => row.shareBp === null) && (
              <p className="rounded-chip bg-warn-bg px-3 py-2 text-14 font-bold text-warn-fg">
                {t("partners.noShares")}
              </p>
            )}
            <PartnerTable rows={shown} hrefFor={hrefFor} />
          </>
        )}
        {balances.unallocated.totalIqd !== 0 && (
          <p className="text-14 text-body-2">
            {t("partners.unallocatedLine")}{" "}
            <Money amount={balances.unallocated.totalIqd} className="font-bold" />
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-18 font-extrabold">{t("partners.equipmentTitle")}</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              href={hrefFor({ equipment: "new" })}
              size="sm"
              variant="secondary"
              scroll={false}
            >
              {t("partners.newOpening")}
            </Button>
            <Button href={adminExpensesHref({ expense: "new" })} size="sm">
              <Plus aria-hidden className="size-4" />
              {t("partners.buyEquipment")}
            </Button>
          </div>
        </div>
        <p className="text-13 text-body-2">{t("partners.equipmentHint")}</p>
        {items.length === 0 ? (
          <Card className="py-6">
            <EmptyState
              icon={Wrench}
              title={t("partners.equipmentEmptyTitle")}
              description={t("partners.equipmentEmptyBody")}
              action={
                <Button href={adminExpensesHref({ expense: "new" })} size="sm">
                  {t("partners.buyEquipment")}
                </Button>
              }
            />
          </Card>
        ) : (
          <EquipmentTable items={items} hrefFor={hrefFor} />
        )}
      </section>

      {query.partner && (
        <Suspense key={query.partner}>
          <PartnerDrawer
            id={query.partner}
            row={balances.partners.find((r) => r.partner.id === query.partner) ?? null}
            month={month}
            today={today}
            books={books}
            hrefFor={hrefFor}
          />
        </Suspense>
      )}
      {query.shares && !query.partner && (
        <Suspense>
          <SharesDrawer
            partners={balances.partners
              .filter((r) => r.partner.active)
              .map((r) => ({ id: r.partner.id, name: r.partner.name }))}
            month={month}
            thisMonth={thisMonth}
            books={books}
            closeHref={hrefFor({ shares: undefined })}
          />
        </Suspense>
      )}
      {query.equipment && !query.partner && !query.shares && (
        <Suspense key={query.equipment}>
          <EquipmentDrawer
            id={query.equipment}
            item={items.find((item) => item.id === query.equipment) ?? null}
            today={today}
            books={books}
            closeHref={hrefFor({ equipment: undefined })}
          />
        </Suspense>
      )}
    </>
  );
}

async function BalanceSheetCard({ sheet, today }: { sheet: BalanceSheet; today: string }) {
  const t = await getTranslations("Admin.finance.partners");
  const difference = sheet.assetsIqd - sheet.liabilitiesIqd - sheet.equityIqd;
  const row = (label: string, amount: number, hint?: string) => (
    <div className="flex flex-col gap-0.5 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-14">{label}</dt>
        <dd>
          <Money amount={amount} className="text-15 font-bold" />
        </dd>
      </div>
      {hint && <p className="text-12 text-muted">{hint}</p>}
    </div>
  );
  const total = (label: string, amount: number) => (
    <div className="flex items-baseline justify-between gap-3 border-t-2 border-navy pt-2">
      <dt className="text-15 font-extrabold">{label}</dt>
      <dd>
        <Money amount={amount} className="text-16 font-black text-navy" />
      </dd>
    </div>
  );
  return (
    <section aria-labelledby="balance-sheet" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="balance-sheet" className="text-18 font-extrabold">
          {t("sheetTitle")}
        </h2>
        <span className="text-14 text-body-2">
          {sheet.asOf === today
            ? t("asOfToday", { date: formatDay(sheet.asOf) })
            : t("asOfEnd", { date: formatDay(sheet.asOf) })}
        </span>
      </div>
      <p
        className={cn(
          "flex items-center gap-2 rounded-chip px-3 py-2 text-14 font-bold",
          sheet.balanced ? "bg-ok-bg text-ok-fg" : "border-2 border-danger bg-surface text-danger",
        )}
      >
        {sheet.balanced ? (
          <CheckCircle2 aria-hidden className="size-4 shrink-0" />
        ) : (
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
        )}
        {sheet.balanced ? (
          t("balanced")
        ) : (
          <span>
            {t("unbalanced")} <Money amount={difference} />
          </span>
        )}
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="flex flex-col p-4">
          <h3 className="text-16 font-extrabold">{t("assets")}</h3>
          <dl className="flex flex-col divide-y divide-divider">
            {row(t("boxes"), sheet.boxesIqd)}
            {row(t("crewCash"), sheet.crewCashIqd)}
            {row(t("receivables"), sheet.receivablesIqd)}
            {row(t("advances"), sheet.advancesIqd)}
            {row(t("equipment"), sheet.equipmentIqd)}
            {total(t("assetsTotal"), sheet.assetsIqd)}
          </dl>
        </Card>
        <Card className="flex flex-col p-4">
          <h3 className="text-16 font-extrabold">{t("liabilities")}</h3>
          <dl className="flex flex-col divide-y divide-divider">
            {row(t("customerCredit"), sheet.customerCreditIqd)}
            {row(t("wagesOwed"), sheet.wagesOwedIqd)}
            {total(t("liabilitiesTotal"), sheet.liabilitiesIqd)}
          </dl>
          <h3 className="mt-4 text-16 font-extrabold">{t("equity")}</h3>
          <dl className="flex flex-col divide-y divide-divider">
            {row(t("partnersEquity"), sheet.partnersIqd)}
            {row(t("unallocated"), sheet.unallocatedProfitIqd)}
            {row(t("openingDifference"), sheet.openingDifferenceIqd, t("openingDifferenceHint"))}
            {total(t("equityTotal"), sheet.equityIqd)}
          </dl>
          <dl className="mt-3">
            {total(t("liabilitiesAndEquity"), sheet.liabilitiesIqd + sheet.equityIqd)}
          </dl>
        </Card>
      </div>
    </section>
  );
}

async function PartnerTable({
  rows,
  hrefFor,
}: {
  rows: PartnerBalance[];
  hrefFor: (patch: Partial<AdminPartnersQuery>) => string;
}) {
  const t = await getTranslations("Admin.finance.partners");
  const columns = [
    "partner",
    "share",
    "opening",
    "capital",
    "withdrawn",
    "profitMonth",
    "profit",
    "balance",
  ] as const;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-4xl text-14">
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
          {rows.map((row) => (
            <tr key={row.partner.id} className="border-t border-divider align-top">
              <th scope="row" className="p-0 text-start">
                <Link
                  href={hrefFor({ partner: row.partner.id })}
                  scroll={false}
                  className="flex min-h-11 flex-wrap items-center gap-x-2 px-3 font-extrabold text-teal underline-offset-2 hover:underline"
                >
                  {row.partner.name}
                  <span className="sr-only"> {t("open")}</span>
                  {!row.partner.active && (
                    <span className="text-12 font-bold text-muted">{t("inactive")}</span>
                  )}
                </Link>
              </th>
              <td className="px-3 py-3">
                {row.shareBp !== null ? (
                  <span dir="ltr">{t("share", { share: formatShare(row.shareBp) })}</span>
                ) : (
                  <span className="text-muted">{t("noShare")}</span>
                )}
              </td>
              <td className="px-3 py-3">
                <Money amount={row.openingIqd} />
              </td>
              <td className="px-3 py-3">
                <Money amount={row.capitalIqd} />
              </td>
              <td className="px-3 py-3">
                <Money amount={row.withdrawnIqd} />
              </td>
              <td className="px-3 py-3">
                <Money amount={row.profitMonthIqd} />
              </td>
              <td className="px-3 py-3">
                <Money amount={row.profitIqd} />
              </td>
              <td className="px-3 py-3">
                <span className="flex flex-col">
                  <Money amount={row.balanceIqd} className="font-bold" />
                  {row.balanceIqd < 0 && (
                    <span className="text-12 font-bold text-danger">{t("overdrawn")}</span>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function EquipmentTable({
  items,
  hrefFor,
}: {
  items: EquipmentItem[];
  hrefFor: (patch: Partial<AdminPartnersQuery>) => string;
}) {
  const t = await getTranslations("Admin.finance.partners");
  const columns = [
    "name",
    "acquired",
    "cost",
    "life",
    "monthly",
    "depreciated",
    "left",
    "status",
  ] as const;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-4xl text-14">
        <caption className="sr-only">{t("equipmentCaption")}</caption>
        <thead className="bg-well text-13 text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2.5 text-start font-bold">
                {t(`equipmentColumns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-divider align-top">
              <th scope="row" className="p-0 text-start">
                <Link
                  href={hrefFor({ equipment: item.id })}
                  scroll={false}
                  className="flex min-h-11 items-center px-3 font-extrabold text-teal underline-offset-2 hover:underline"
                >
                  {item.name}
                  <span className="sr-only"> {t("openItem")}</span>
                </Link>
              </th>
              <td className="px-3 py-3">
                {item.kind === "opening" ? t("openingItem") : formatDay(item.acquiredOn)}
              </td>
              <td className="px-3 py-3">
                <Money amount={item.costIqd} />
              </td>
              <td className="px-3 py-3">{t("months", { count: item.lifeMonths })}</td>
              <td className="px-3 py-3">
                <Money amount={item.monthlyIqd} />
              </td>
              <td className="px-3 py-3">
                <Money amount={item.depreciatedIqd} />
              </td>
              <td className="px-3 py-3">
                <Money amount={item.bookValueIqd} className="font-bold" />
              </td>
              <td className="px-3 py-3">
                {item.disposal ? (
                  <span className="flex flex-col">
                    <span>{t("disposedOn", { date: formatDay(item.disposal.disposedOn) })}</span>
                    <Money amount={item.disposal.resultIqd} className="text-13" />
                  </span>
                ) : (
                  t("inUse")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotFound({ title, closeHref }: { title: string; closeHref: string }) {
  return (
    <Drawer title={title} closeHref={closeHref}>
      <NotFoundBody title={title} />
    </Drawer>
  );
}

async function NotFoundBody({ title }: { title: string }) {
  const t = await getTranslations("Admin.finance");
  return <EmptyState icon={SearchX} title={title} description={t("notFoundBody")} />;
}

/** The boxes a movement or a sale price may use, named as people say them. */
async function boxOptions() {
  const t = await getTranslations("Admin.finance");
  const accounts = await financeAccounts();
  return accounts.map((a) => ({
    id: a.id,
    label: accountName(a, (crew) => t("crewBox", { crew })),
    active: a.active,
  }));
}

async function PartnerDrawer({
  id,
  row,
  month,
  today,
  books,
  hrefFor,
}: {
  id: string;
  row: PartnerBalance | null;
  month: string;
  today: string;
  books: FinanceBooks;
  hrefFor: (patch: Partial<AdminPartnersQuery>) => string;
}) {
  const t = await getTranslations("Admin.finance");
  const closeHref = hrefFor({ partner: undefined });
  const booksClosed = books.closedThrough !== null;
  const monthParam = month === today.slice(0, 7) ? undefined : month;

  if (id === "new") {
    return (
      <Drawer title={t("partner.newTitle")} closeHref={closeHref}>
        <PartnerForm
          partner={null}
          booksClosed={booksClosed}
          month={monthParam}
          closeHref={closeHref}
        />
      </Drawer>
    );
  }
  if (!row) return <NotFound title={t("partner.notFound")} closeHref={closeHref} />;

  const [movements, accounts] = await Promise.all([partnerMovements(id), boxOptions()]);
  const figures: [string, ReactNode][] = [
    [
      t("partners.columns.share"),
      row.shareBp !== null ? (
        <span dir="ltr">{t("partners.share", { share: formatShare(row.shareBp) })}</span>
      ) : (
        t("partners.noShare")
      ),
    ],
    [t("partners.columns.opening"), <Money key="o" amount={row.openingIqd} />],
    [t("partners.columns.capital"), <Money key="c" amount={row.capitalIqd} />],
    [t("partners.columns.withdrawn"), <Money key="w" amount={row.withdrawnIqd} />],
    [t("partners.columns.profitMonth"), <Money key="m" amount={row.profitMonthIqd} />],
    [t("partners.columns.profit"), <Money key="p" amount={row.profitIqd} />],
    [t("partners.columns.balance"), <Money key="b" amount={row.balanceIqd} />],
  ];

  return (
    <Drawer title={row.partner.name} closeHref={closeHref}>
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h3 className="text-16 font-extrabold">{t("partner.monthTitle")}</h3>
          <Card className="p-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              {figures.map(([label, value]) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <dt className="text-13 text-muted">{label}</dt>
                  <dd className="text-15 font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </section>
        <section className="flex flex-col gap-3">
          <h3 className="text-16 font-extrabold">{t("partner.detailsTitle")}</h3>
          <PartnerForm
            key={`${row.partner.id}-${row.partner.name}-${row.partner.active}`}
            partner={row.partner}
            booksClosed={booksClosed}
            month={monthParam}
            closeHref={closeHref}
          />
        </section>
        <MovementSection
          key={movements.length}
          partnerId={row.partner.id}
          movements={movements}
          accounts={accounts}
          firstDay={firstOpenDay(books)}
          today={today}
          closedThrough={books.closedThrough}
          closeHref={hrefFor({ partner: row.partner.id })}
        />
      </div>
    </Drawer>
  );
}

async function SharesDrawer({
  partners,
  month,
  thisMonth,
  books,
  closeHref,
}: {
  partners: { id: string; name: string }[];
  month: string;
  thisMonth: string;
  books: FinanceBooks;
  closeHref: string;
}) {
  const t = await getTranslations("Admin.finance");
  const sets = await shareSets();
  // A set may start in any open month of the books, through this one.
  const first = firstOpenDay(books).slice(0, 7);
  const months: string[] = [];
  for (let m = thisMonth; m >= first; m = addMonthsTo(m, -1)) months.push(m);
  if (months.length === 0) months.push(thisMonth);
  const initial = months.includes(month) ? month : (months[0] ?? thisMonth);
  return (
    <Drawer title={t("shares.title")} closeHref={closeHref}>
      <SharesForm
        key={sets.map((s) => s.month).join()}
        partners={partners}
        sets={sets}
        months={months}
        initialMonth={initial}
        closedThrough={books.closedThrough}
      />
    </Drawer>
  );
}

async function EquipmentDrawer({
  id,
  item,
  today,
  books,
  closeHref,
}: {
  id: string;
  item: EquipmentItem | null;
  today: string;
  books: FinanceBooks;
  closeHref: string;
}) {
  const t = await getTranslations("Admin.finance");
  const booksClosed = books.closedThrough !== null;
  if (id === "new") {
    return (
      <Drawer title={t("equipment.newTitle")} closeHref={closeHref}>
        <OpeningEquipmentForm item={null} booksClosed={booksClosed} closeHref={closeHref} />
      </Drawer>
    );
  }
  if (!item) return <NotFound title={t("equipment.notFound")} closeHref={closeHref} />;

  const [opening, disposal, accounts] = await Promise.all([
    item.kind === "opening" ? getOpeningEquipment(item.id) : Promise.resolve(null),
    liveDisposal(item.id),
    boxOptions(),
  ]);
  const figures: [string, ReactNode][] = [
    [
      t("equipment.acquired"),
      item.kind === "opening" ? t("partners.openingItem") : formatDay(item.acquiredOn),
    ],
    [t("equipment.cost"), <Money key="c" amount={item.costIqd} />],
    [t("equipment.life"), t("partners.months", { count: item.lifeMonths })],
    [t("equipment.monthly"), <Money key="m" amount={item.monthlyIqd} />],
    [t("equipment.depreciated"), <Money key="d" amount={item.depreciatedIqd} />],
    [t("equipment.left"), <Money key="l" amount={item.bookValueIqd} />],
    ...(item.disposal
      ? [
          [t("equipment.result"), <Money key="r" amount={item.disposal.resultIqd} />] as [
            string,
            ReactNode,
          ],
        ]
      : []),
  ];

  return (
    <Drawer title={item.name} closeHref={closeHref}>
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h3 className="text-16 font-extrabold">{t("equipment.summaryTitle")}</h3>
          <Card className="p-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              {figures.map(([label, value]) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <dt className="text-13 text-muted">{label}</dt>
                  <dd className="text-15 font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {item.expenseId && (
            <Button
              href={adminExpensesHref({ expense: item.expenseId })}
              size="sm"
              variant="secondary"
              className="self-start"
            >
              {t("equipment.openExpense")}
            </Button>
          )}
        </section>
        <DisposalSection
          key={disposal?.id ?? "none"}
          item={{ kind: item.kind, id: item.id, acquiredOn: item.acquiredOn }}
          disposal={disposal}
          accounts={accounts}
          firstDay={firstOpenDay(books)}
          today={today}
          closedThrough={books.closedThrough}
          closeHref={closeHref}
        />
        {opening && !disposal && (
          <section className="flex flex-col gap-3">
            <h3 className="text-16 font-extrabold">{t("partner.detailsTitle")}</h3>
            <OpeningEquipmentForm item={opening} booksClosed={booksClosed} closeHref={closeHref} />
          </section>
        )}
      </div>
    </Drawer>
  );
}

function PartnersSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4">
      <Skeleton className="h-11 w-72" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-card" />
        <Skeleton className="h-72 rounded-card" />
      </div>
      <Skeleton className="h-64 rounded-card" />
    </SkeletonGroup>
  );
}
