import { ListFilter, Plus, ReceiptText, SearchX } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

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
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { addMonthsTo } from "@/lib/admin/calendar";
import {
  type Expense,
  type ExpenseCategory,
  expenseCategories,
  type FinanceAccount,
  financeAccounts,
  financeBooks,
  getExpense,
  listExpenses,
} from "@/lib/admin/finance-queries";
import {
  ADMIN_EXPENSES_PAGE,
  type AdminExpensesQuery,
  adminExpensesHref,
  parseAdminExpensesQuery,
} from "@/lib/admin/finance-query";
import { firstOpenDay, isClosed } from "@/lib/admin/finance-reports";
import { payrollMonth, workerOptions } from "@/lib/admin/payroll-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { baghdadToday, formatDay } from "@/lib/dates";
import { routes } from "@/lib/routes";

import { ExpenseForm } from "./expense-form";

/**
 * Expenses (A16, spec §8.3): a month's expenses, newest first, filtered by
 * category, box and note words, with the total. `?expense=new|<id>` opens
 * the drawer to record, edit or void one; `?voided=1` lists the voided ones.
 */
export default async function ExpensesPage(props: PageProps<"/admin/finance/expenses">) {
  const t = await getTranslations("Admin.finance.expenses");
  return (
    <AdminPage title={t("title")}>
      <FinanceTabs current="expenses" />
      <Suspense fallback={<ExpensesSkeleton />}>
        <Expenses {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Expenses({ searchParams }: PageProps<"/admin/finance/expenses">) {
  await requireViewer(routes.adminExpenses, "admin");
  const t = await getTranslations("Admin.finance");
  const query = parseAdminExpensesQuery(await searchParams);
  const today = baghdadToday();
  const thisMonth = today.slice(0, 7);
  const month = query.month && query.month <= thisMonth ? query.month : thisMonth;
  const [accounts, categories, list, books, workers] = await Promise.all([
    financeAccounts(),
    expenseCategories(),
    listExpenses(query, month),
    financeBooks(),
    workerOptions(),
  ]);
  const workerNames = new Map(workers.map((worker) => [worker.id, worker.name]));
  const hrefFor = (patch: Partial<AdminExpensesQuery>) => adminExpensesHref({ ...query, ...patch });
  const accountNames = new Map(
    accounts.map((account) => [account.id, accountName(account, (crew) => t("crewBox", { crew }))]),
  );
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const filtered = Boolean(query.category || query.account || query.q);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker
            month={month}
            prevHref={hrefFor({ month: addMonthsTo(month, -1), n: undefined, expense: undefined })}
            nextHref={
              month < thisMonth
                ? hrefFor({ month: addMonthsTo(month, 1), n: undefined, expense: undefined })
                : null
            }
          />
          {isClosed(books, month) && <ClosedBadge />}
        </div>
        <Button href={hrefFor({ expense: "new" })} size="sm" scroll={false}>
          <Plus aria-hidden className="size-4" />
          {t("expenses.new")}
        </Button>
      </div>

      <Form
        // A fresh form when the URL changes (Next keeps the page alive).
        key={`${query.category ?? ""}-${query.account ?? ""}-${query.q ?? ""}`}
        action={routes.adminExpenses}
        className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-4"
      >
        {query.month && <input type="hidden" name="month" value={query.month} />}
        {query.voided && <input type="hidden" name="voided" value="1" />}
        <Field label={t("expenses.category")} variant="compact" className="w-52">
          {(control) => (
            <Select
              {...control}
              name="category"
              variant="compact"
              defaultValue={query.category ?? ""}
            >
              <option value="">{t("expenses.allCategories")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("expenses.account")} variant="compact" className="w-52">
          {(control) => (
            <Select
              {...control}
              name="account"
              variant="compact"
              defaultValue={query.account ?? ""}
            >
              <option value="">{t("expenses.allAccounts")}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {accountNames.get(account.id)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("expenses.search")} variant="compact" className="min-w-52 flex-1">
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
          {t("expenses.apply")}
        </Button>
        {filtered && (
          <Button
            href={adminExpensesHref({ month: query.month, voided: query.voided })}
            variant="secondary"
            size="sm"
          >
            {t("expenses.clear")}
          </Button>
        )}
      </Form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-15 text-body-2" role="status">
          {t(query.voided ? "expenses.voidedTotal" : "expenses.total", { count: list.count })}{" "}
          <Money amount={list.total} className="text-18 font-black text-navy" />
        </p>
        <Link
          href={hrefFor({ voided: !query.voided, n: undefined, expense: undefined })}
          className="inline-flex min-h-11 items-center text-14 font-bold text-teal underline-offset-2 hover:underline"
        >
          {query.voided ? t("expenses.showLive") : t("expenses.showVoided")}
        </Link>
      </div>

      {list.expenses.length === 0 ? (
        <Card className="py-6">
          <EmptyState
            icon={ReceiptText}
            title={
              filtered
                ? t("expenses.emptyFiltered")
                : query.voided
                  ? t("expenses.emptyVoided")
                  : t("expenses.emptyTitle")
            }
            description={filtered || query.voided ? undefined : t("expenses.emptyBody")}
            action={
              filtered || query.voided ? undefined : (
                <Button href={hrefFor({ expense: "new" })} size="sm" scroll={false}>
                  {t("expenses.first")}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <ExpenseTable
            expenses={list.expenses}
            accountNames={accountNames}
            categoryNames={categoryNames}
            workerNames={workerNames}
            hrefFor={hrefFor}
          />
          {list.more && (
            <Button
              href={hrefFor({ n: query.n + ADMIN_EXPENSES_PAGE, expense: undefined })}
              variant="secondary"
              size="sm"
              scroll={false}
              className="self-center"
            >
              {t("expenses.more")}
            </Button>
          )}
        </>
      )}

      {query.expense && (
        <Suspense key={query.expense}>
          <ExpenseDrawer
            id={query.expense}
            accounts={accounts}
            accountNames={accountNames}
            categories={categories}
            payWorkerId={query.expense === "new" ? query.worker : undefined}
            today={today}
            closeHref={hrefFor({ expense: undefined, worker: undefined })}
          />
        </Suspense>
      )}
    </>
  );
}

async function ExpenseTable({
  expenses,
  accountNames,
  categoryNames,
  workerNames,
  hrefFor,
}: {
  expenses: Expense[];
  accountNames: Map<string, string>;
  categoryNames: Map<number, string>;
  /** A wage's worker (A21) shows under its category. */
  workerNames: Map<string, string>;
  hrefFor: (patch: Partial<AdminExpensesQuery>) => string;
}) {
  const t = await getTranslations("Admin.finance");
  const columns = ["date", "category", "note", "account", "amount"] as const;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-3xl text-14">
        <caption className="sr-only">{t("expenses.caption")}</caption>
        <thead className="bg-well text-13 text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2.5 text-start font-bold">
                {t(`expenses.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {expenses.map((expense) => (
            <tr key={expense.id} className="border-t border-divider align-top">
              <td className="p-0">
                <Link
                  href={hrefFor({ expense: expense.id })}
                  scroll={false}
                  className="flex min-h-11 items-center px-3 font-extrabold whitespace-nowrap text-teal underline-offset-2 hover:underline"
                >
                  {formatDay(expense.spentOn)}
                  <span className="sr-only"> {t("expenses.open")}</span>
                </Link>
              </td>
              <td className="px-3 py-3">
                {categoryNames.get(expense.categoryId)}
                {expense.workerId && (
                  <span className="block text-13 text-body-2">
                    {workerNames.get(expense.workerId)}
                  </span>
                )}
              </td>
              <td className="px-3 py-3">{expense.note ?? t("none")}</td>
              <td className="px-3 py-3">{accountNames.get(expense.accountId)}</td>
              <td className="px-3 py-3">
                <Money amount={expense.amountIqd} className="font-bold" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function ExpenseDrawer({
  id,
  accounts,
  accountNames,
  categories,
  payWorkerId,
  today,
  closeHref,
}: {
  id: string;
  accounts: FinanceAccount[];
  accountNames: Map<string, string>;
  categories: ExpenseCategory[];
  /** A new wage for this worker (A21's "ادفع له"). */
  payWorkerId: string | undefined;
  today: string;
  closeHref: string;
}) {
  const t = await getTranslations("Admin.finance");
  const isNew = id === "new";
  const [expense, books, workers, owed] = await Promise.all([
    isNew ? null : getExpense(id),
    financeBooks(),
    workerOptions(),
    // What the worker is owed at the end of this month.
    payWorkerId ? payrollMonth(today.slice(0, 7), payWorkerId) : [],
  ]);
  const payWorker = payWorkerId ? { id: payWorkerId, owedIqd: owed[0]?.balanceIqd ?? 0 } : null;

  if (!isNew && !expense) {
    return (
      <Drawer title={t("expense.notFound")} closeHref={closeHref}>
        <EmptyState icon={SearchX} title={t("expense.notFound")} description={t("notFoundBody")} />
      </Drawer>
    );
  }

  return (
    <Drawer closeHref={closeHref} title={expense ? t("expense.editTitle") : t("expense.newTitle")}>
      <ExpenseForm
        key={expense?.id ?? "new"}
        expense={expense}
        accounts={accounts.map((account) => ({
          id: account.id,
          label: accountNames.get(account.id) ?? "",
          active: account.active,
        }))}
        categories={categories}
        workers={workers}
        payWorker={payWorker}
        today={today}
        firstDay={firstOpenDay(books)}
        closed={expense !== null && isClosed(books, expense.spentOn)}
        closeHref={closeHref}
      />
    </Drawer>
  );
}

function ExpensesSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4">
      <Skeleton className="h-11 w-72" />
      <Skeleton className="h-20 rounded-card" />
      <Skeleton className="h-96 rounded-card" />
    </SkeletonGroup>
  );
}
