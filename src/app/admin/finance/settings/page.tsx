import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { accountName, FinanceTabs } from "@/components/admin/finance";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { expenseCategories, financeAccounts, financeStartOn } from "@/lib/admin/finance-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { baghdadToday } from "@/lib/dates";
import { routes } from "@/lib/routes";

import { AccountList } from "./account-list";
import { CategoryList } from "./category-list";
import { StartForm } from "./start-form";

/**
 * Accounts settings (A17, spec §8.3): the day the books start, the money
 * boxes (add, rename, opening balance, switch off) and the expense
 * categories (add, rename, kind, switch off, delete while unused).
 */
export default async function FinanceSettingsPage() {
  const t = await getTranslations("Admin.finance.settings");
  return (
    <AdminPage title={t("title")}>
      <FinanceTabs current="settings" />
      <Suspense
        fallback={
          <SkeletonGroup className="flex flex-col gap-4">
            <Skeleton className="h-36 rounded-card" />
            <Skeleton className="h-72 rounded-card" />
            <Skeleton className="h-72 rounded-card" />
          </SkeletonGroup>
        }
      >
        <Settings />
      </Suspense>
    </AdminPage>
  );
}

async function Settings() {
  await requireViewer(routes.adminFinanceSettings, "admin");
  const t = await getTranslations("Admin.finance");
  const [startOn, accounts, categories] = await Promise.all([
    financeStartOn(),
    financeAccounts(),
    expenseCategories(),
  ]);

  return (
    <>
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-18 font-extrabold">{t("settings.startTitle")}</h2>
        <p className="max-w-3xl text-14 text-body-2">{t("settings.startIntro")}</p>
        <StartForm key={startOn} startOn={startOn} today={baghdadToday()} />
      </Card>
      <section aria-labelledby="boxes-title" className="flex flex-col gap-3">
        <h2 id="boxes-title" className="text-20 font-black">
          {t("settings.boxesTitle")}
        </h2>
        <p className="max-w-3xl text-14 text-body-2">{t("settings.boxesIntro")}</p>
        <AccountList
          accounts={accounts.map((account) => ({
            ...account,
            label: accountName(account, (crew) => t("crewBox", { crew })),
          }))}
        />
      </section>
      <section aria-labelledby="categories-title" className="flex flex-col gap-3">
        <h2 id="categories-title" className="text-20 font-black">
          {t("settings.categoriesTitle")}
        </h2>
        <p className="max-w-3xl text-14 text-body-2">{t("settings.categoriesIntro")}</p>
        <CategoryList categories={categories} />
      </section>
    </>
  );
}
