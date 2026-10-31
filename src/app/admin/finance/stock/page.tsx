import { ClipboardList, Minus, Package, Plus, SearchX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { Drawer } from "@/components/admin/drawer";
import { ClosedBadge, FinanceTabs, MonthPicker } from "@/components/admin/finance";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { addMonthsTo } from "@/lib/admin/calendar";
import { financeBooks } from "@/lib/admin/finance-queries";
import {
  type AdminStockQuery,
  adminStockHref,
  parseAdminStockQuery,
} from "@/lib/admin/finance-query";
import { type FinanceBooks, firstOpenDay, isClosed } from "@/lib/admin/finance-reports";
import { crewOptions } from "@/lib/admin/payroll-queries";
import {
  getStockMove,
  linkableExpense,
  linkableExpenses,
  type StockItem,
  type StockMonth,
  type StockMove,
  stockItems,
  stockMonth,
  stockItemHasRecords,
  stockMoves,
} from "@/lib/admin/stock-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { addDays, baghdadToday, formatDay } from "@/lib/dates";
import { routes } from "@/lib/routes";
import { formatQuantity, type StockMoveKind } from "@/lib/schemas/stock";

import { StockItemForm, StockMoveForm } from "./stock-forms";

/**
 * Stock (A23, spec §8.3; Phase 7, task 6): each item's quantity now and
 * whether it is low, the month's totals and records. Quantities only: a
 * purchase stays an expense (A16). `?item=` and `?move=` open drawers.
 */
export default async function StockPage(props: PageProps<"/admin/finance/stock">) {
  const t = await getTranslations("Admin.finance.stock");
  return (
    <AdminPage title={t("title")}>
      <FinanceTabs current="stock" />
      <Suspense fallback={<StockSkeleton />}>
        <Stock {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Stock({ searchParams }: PageProps<"/admin/finance/stock">) {
  await requireViewer(routes.adminStock, "admin");
  const t = await getTranslations("Admin.finance.stock");
  const query = parseAdminStockQuery(await searchParams);
  const today = baghdadToday();
  const thisMonth = today.slice(0, 7);
  const books = await financeBooks();
  const firstMonth = books.startOn.slice(0, 7);
  const asked = query.month && query.month <= thisMonth ? query.month : thisMonth;
  const month = asked < firstMonth ? firstMonth : asked;
  const [items, figures, moves] = await Promise.all([
    stockItems(),
    stockMonth(month),
    stockMoves(month),
  ]);
  // The month shown, when one was asked for (a month outside the books shows the nearest).
  const hrefFor = (patch: Partial<AdminStockQuery>) =>
    adminStockHref({ month: query.month ? month : undefined, ...patch });
  const active = items.filter((item) => item.active);
  const inactive = items.filter((item) => !item.active);
  const low = active.filter((item) => item.low);
  const canRecord = firstOpenDay(books) <= today && active.length > 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker
            month={month}
            prevHref={month > firstMonth ? hrefFor({ month: addMonthsTo(month, -1) }) : null}
            nextHref={month < thisMonth ? hrefFor({ month: addMonthsTo(month, 1) }) : null}
          />
          {isClosed(books, month) && <ClosedBadge />}
        </div>
        <div className="flex flex-wrap gap-2">
          {canRecord && (
            <>
              <Button href={hrefFor({ move: "new", kind: "in" })} size="sm" scroll={false}>
                <Plus aria-hidden className="size-4" />
                {t("receive")}
              </Button>
              <Button
                href={hrefFor({ move: "new", kind: "out" })}
                size="sm"
                variant="secondary"
                scroll={false}
              >
                <Minus aria-hidden className="size-4" />
                {t("use")}
              </Button>
              <Button
                href={hrefFor({ move: "new", kind: "count" })}
                size="sm"
                variant="secondary"
                scroll={false}
              >
                <ClipboardList aria-hidden className="size-4" />
                {t("count")}
              </Button>
            </>
          )}
          <Button href={hrefFor({ item: "new" })} size="sm" variant="secondary" scroll={false}>
            <Package aria-hidden className="size-4" />
            {t("newItem")}
          </Button>
        </div>
      </div>
      <p className="text-13 text-body-2">{t("hint")}</p>

      {items.length === 0 ? (
        <Card className="py-6">
          <EmptyState
            icon={Package}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            action={
              <Button href={hrefFor({ item: "new" })} size="sm" scroll={false}>
                {t("firstItem")}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <section aria-labelledby="stock-now" className="flex flex-col gap-3">
            <h2 id="stock-now" className="text-18 font-extrabold">
              {t("itemsTitle")}
            </h2>
            {low.length > 0 && (
              <p className="flex items-center gap-2 rounded-chip bg-warn-bg px-3 py-2 text-14 font-bold text-warn-fg">
                <TriangleAlert aria-hidden className="size-4 shrink-0" />
                {t("lowBanner", { count: low.length })}
              </p>
            )}
            {active.length > 0 && <ItemTable items={active} hrefFor={hrefFor} />}
            {inactive.length > 0 && (
              <>
                <h3 className="text-16 font-extrabold text-muted">{t("inactiveTitle")}</h3>
                <ItemTable items={inactive} hrefFor={hrefFor} />
              </>
            )}
          </section>

          <section aria-labelledby="stock-month" className="flex flex-col gap-3">
            <h2 id="stock-month" className="text-18 font-extrabold">
              {t("monthTitle")}
            </h2>
            <MonthTable items={items} figures={figures} />
          </section>

          <section aria-labelledby="stock-moves" className="flex flex-col gap-3">
            <h2 id="stock-moves" className="text-18 font-extrabold">
              {t("movesTitle")}
            </h2>
            {moves.length === 0 ? (
              <p className="text-14 text-body-2">{t("monthEmpty")}</p>
            ) : (
              <MoveTable moves={moves} items={items} hrefFor={hrefFor} />
            )}
          </section>
        </>
      )}

      {query.item && (
        <Suspense key={query.item}>
          <ItemDrawer
            id={query.item}
            item={items.find((item) => item.id === query.item) ?? null}
            month={month}
            today={today}
            hrefFor={hrefFor}
          />
        </Suspense>
      )}
      {query.move && !query.item && (
        <Suspense key={`${query.move}-${query.kind ?? ""}-${query.of ?? ""}`}>
          <MoveDrawer
            id={query.move}
            kind={query.kind ?? "in"}
            expenseId={query.expense}
            itemId={query.of}
            items={items}
            books={books}
            today={today}
            closeHref={hrefFor({})}
          />
        </Suspense>
      )}
    </>
  );
}

function Qty({ value, unit }: { value: number; unit: string }) {
  return (
    <span dir="ltr" className="whitespace-nowrap">
      {formatQuantity(value)} <bdi>{unit}</bdi>
    </span>
  );
}

async function ItemTable({
  items,
  hrefFor,
}: {
  items: StockItem[];
  hrefFor: (patch: Partial<AdminStockQuery>) => string;
}) {
  const t = await getTranslations("Admin.finance.stock");
  const columns = ["name", "quantity", "minimum", "status", "last"] as const;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-2xl text-14">
        <caption className="sr-only">{t("itemsCaption")}</caption>
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
          {items.map((item) => (
            <tr key={item.id} className="border-t border-divider">
              <th scope="row" className="p-0 text-start">
                <Link
                  href={hrefFor({ item: item.id })}
                  scroll={false}
                  className="flex min-h-11 items-center px-3 font-extrabold text-teal underline-offset-2 hover:underline"
                >
                  {item.name}
                  <span className="sr-only"> {t("openItem")}</span>
                </Link>
              </th>
              <td className="px-3 py-3 font-bold">
                <Qty value={item.quantity} unit={item.unit} />
              </td>
              <td className="px-3 py-3">
                <Qty value={item.minQuantity} unit={item.unit} />
              </td>
              <td className="px-3 py-3">
                {item.active && (
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-12 font-bold",
                      item.low ? "bg-warn-bg text-warn-fg" : "bg-ok-bg text-ok-fg",
                    )}
                  >
                    {item.low ? t("low") : t("ok")}
                  </span>
                )}
              </td>
              <td className="px-3 py-3">
                {item.lastMovedOn ? formatDay(item.lastMovedOn) : t("never")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function MonthTable({
  items,
  figures,
}: {
  items: StockItem[];
  figures: Map<string, StockMonth>;
}) {
  const t = await getTranslations("Admin.finance.stock");
  const rows = items
    .map((item) => ({ item, month: figures.get(item.id) }))
    .filter(
      (row): row is { item: StockItem; month: StockMonth } =>
        row.month !== undefined &&
        (row.month.openingQuantity !== 0 ||
          row.month.inQuantity !== 0 ||
          row.month.outQuantity !== 0 ||
          row.month.correctionQuantity !== 0 ||
          row.month.closingQuantity !== 0),
    );
  if (rows.length === 0) return <p className="text-14 text-body-2">{t("monthEmpty")}</p>;
  const columns = ["name", "opening", "in", "out", "correction", "closing"] as const;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-3xl text-14">
        <caption className="sr-only">{t("monthCaption")}</caption>
        <thead className="bg-well text-13 text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2.5 text-start font-bold">
                {t(`monthColumns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, month }) => (
            <tr key={item.id} className="border-t border-divider">
              <th scope="row" className="px-3 py-3 text-start font-extrabold">
                {item.name}
              </th>
              <td className="px-3 py-3">
                <Qty value={month.openingQuantity} unit={item.unit} />
              </td>
              <td className="px-3 py-3">
                <Qty value={month.inQuantity} unit={item.unit} />
              </td>
              <td className="px-3 py-3">
                <Qty value={month.outQuantity} unit={item.unit} />
              </td>
              <td className={cn("px-3 py-3", month.correctionQuantity < 0 && "text-danger")}>
                <span dir="ltr" className="whitespace-nowrap">
                  {month.correctionQuantity > 0 ? "+" : month.correctionQuantity < 0 ? "−" : ""}
                  {formatQuantity(Math.abs(month.correctionQuantity))} <bdi>{item.unit}</bdi>
                </span>
              </td>
              <td className="px-3 py-3 font-bold">
                <Qty value={month.closingQuantity} unit={item.unit} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function MoveTable({
  moves,
  items,
  hrefFor,
}: {
  moves: StockMove[];
  items: StockItem[];
  hrefFor: (patch: Partial<AdminStockQuery>) => string;
}) {
  const t = await getTranslations("Admin.finance.stock");
  const byId = new Map(items.map((item) => [item.id, item]));
  const columns = ["date", "name", "kind", "quantity", "details"] as const;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-3xl text-14">
        <caption className="sr-only">{t("movesCaption")}</caption>
        <thead className="bg-well text-13 text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2.5 text-start font-bold">
                {t(`moveColumns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {moves.map((move) => {
            const item = byId.get(move.itemId);
            const voided = move.voidedAt !== null;
            return (
              <tr
                key={move.id}
                className={cn("border-t border-divider", voided && "text-muted line-through")}
              >
                <th scope="row" className="p-0 text-start">
                  <Link
                    href={hrefFor({ move: move.id })}
                    scroll={false}
                    className="flex min-h-11 items-center px-3 font-bold text-teal underline-offset-2 hover:underline"
                  >
                    {formatDay(move.movedOn)}
                    <span className="sr-only">
                      {" "}
                      {t("openMove")}
                      {voided && ` · ${t("voided")}`}
                    </span>
                  </Link>
                </th>
                <td className="px-3 py-3 font-bold">{item?.name}</td>
                <td className="px-3 py-3">{t(`kinds.${move.kind}`)}</td>
                <td className="px-3 py-3">
                  <Qty value={move.quantity} unit={item?.unit ?? ""} />
                </td>
                <td className="px-3 py-3 text-13">
                  {[
                    move.crewName ? t("crew", { crew: move.crewName }) : null,
                    move.expense ? t("paidBy", { label: move.expense.label }) : null,
                    move.note,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function NotFound({ title, closeHref }: { title: string; closeHref: string }) {
  const t = await getTranslations("Admin.finance");
  return (
    <Drawer title={title} closeHref={closeHref}>
      <EmptyState icon={SearchX} title={title} description={t("notFoundBody")} />
    </Drawer>
  );
}

async function ItemDrawer({
  id,
  item,
  month,
  today,
  hrefFor,
}: {
  id: string;
  item: StockItem | null;
  month: string;
  today: string;
  hrefFor: (patch: Partial<AdminStockQuery>) => string;
}) {
  const t = await getTranslations("Admin.finance.stock");
  const closeHref = hrefFor({ item: undefined });
  const monthParam = month === today.slice(0, 7) ? undefined : month;

  if (id === "new") {
    return (
      <Drawer title={t("item.newTitle")} closeHref={closeHref}>
        <StockItemForm item={null} deletable={false} month={monthParam} closeHref={closeHref} />
      </Drawer>
    );
  }
  if (!item) return <NotFound title={t("item.notFound")} closeHref={closeHref} />;

  const [moves, hasRecords] = await Promise.all([
    stockMoves(month, item.id),
    stockItemHasRecords(item.id),
  ]);
  return (
    <Drawer title={item.name} closeHref={closeHref}>
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h3 className="text-16 font-extrabold">{t("item.nowTitle")}</h3>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <span className="flex flex-col gap-0.5">
              <span className="text-13 text-muted">{t("item.now")}</span>
              <span className="text-18 font-black">
                <Qty value={item.quantity} unit={item.unit} />
              </span>
            </span>
            {item.active && (
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-12 font-bold",
                  item.low ? "bg-warn-bg text-warn-fg" : "bg-ok-bg text-ok-fg",
                )}
              >
                {item.low ? t("low") : t("ok")}
              </span>
            )}
          </Card>
          {item.active && (
            <div className="flex flex-wrap gap-2">
              {(["in", "out", "count"] as const).map((kind) => (
                <Button
                  key={kind}
                  href={adminStockHref({ month: monthParam, move: "new", kind, of: item.id })}
                  size="sm"
                  variant={kind === "in" ? "primary" : "secondary"}
                  scroll={false}
                >
                  {t(kind === "in" ? "receive" : kind === "out" ? "use" : "count")}
                </Button>
              ))}
            </div>
          )}
        </section>
        <section className="flex flex-col gap-3">
          <h3 className="text-16 font-extrabold">{t("item.detailsTitle")}</h3>
          <StockItemForm
            key={`${item.id}-${item.name}-${item.active}-${item.minQuantity}`}
            item={item}
            deletable={!hasRecords}
            month={monthParam}
            closeHref={closeHref}
          />
        </section>
        <section className="flex flex-col gap-3">
          <h3 className="text-16 font-extrabold">{t("item.movesTitle")}</h3>
          {moves.length === 0 ? (
            <p className="text-14 text-body-2">{t("item.noMoves")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-divider rounded-card border border-border bg-surface">
              {moves.map((move) => (
                <li key={move.id}>
                  <Link
                    href={hrefFor({ item: undefined, move: move.id })}
                    scroll={false}
                    className={cn(
                      "flex min-h-11 flex-wrap items-center gap-x-2 px-3 py-2 text-14 underline-offset-2 hover:underline",
                      move.voidedAt && "text-muted line-through",
                    )}
                  >
                    <span className="font-bold">{formatDay(move.movedOn)}</span>
                    {t(`kinds.${move.kind}`)}
                    <Qty value={move.quantity} unit={item.unit} />
                    {move.voidedAt && <span className="sr-only">{t("voided")}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}

async function MoveDrawer({
  id,
  kind,
  expenseId,
  itemId,
  items,
  books,
  today,
  closeHref,
}: {
  id: string;
  kind: StockMoveKind;
  expenseId: string | undefined;
  /** A new record's item (from the item's drawer). */
  itemId: string | undefined;
  items: StockItem[];
  books: FinanceBooks;
  today: string;
  closeHref: string;
}) {
  const t = await getTranslations("Admin.finance.stock");
  const isNew = id === "new";
  const move = isNew ? null : await getStockMove(id);
  if (!isNew && !move) return <NotFound title={t("move.notFound")} closeHref={closeHref} />;
  const moveKind = move?.kind ?? kind;
  const firstDay = firstOpenDay(books);
  // Expenses from the last 60 days an in may name (or the one A16 sent).
  const since = addDays(today, -60);
  const [crews, expenses, fixedExpense] = await Promise.all([
    moveKind === "out" ? crewOptions() : Promise.resolve([]),
    moveKind === "in"
      ? linkableExpenses(since < books.startOn ? books.startOn : since, today)
      : Promise.resolve([]),
    expenseId && isNew ? linkableExpense(expenseId) : Promise.resolve(null),
  ]);
  const linked =
    move?.expense && !expenses.some((e) => e.id === move.expense?.id) ? [move.expense] : [];

  return (
    <Drawer
      title={move ? t("move.editTitle") : t(`move.newTitle.${moveKind}`)}
      closeHref={closeHref}
    >
      <StockMoveForm
        key={move?.id ?? `new-${moveKind}-${itemId ?? ""}`}
        move={move}
        kind={moveKind}
        items={items}
        crews={crews}
        expenses={[...linked, ...expenses]}
        fixedExpense={fixedExpense}
        defaultItemId={itemId}
        firstDay={firstDay}
        today={today}
        closed={move !== null && isClosed(books, move.movedOn)}
        closeHref={closeHref}
      />
    </Drawer>
  );
}

function StockSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4">
      <Skeleton className="h-11 w-72" />
      <Skeleton className="h-64 rounded-card" />
      <Skeleton className="h-64 rounded-card" />
    </SkeletonGroup>
  );
}
