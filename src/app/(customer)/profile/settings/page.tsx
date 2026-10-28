import { ChevronRight, FileText, Languages, type LucideIcon, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Screen } from "@/components/layout/screen";
import { BackButton } from "@/components/ui/back-button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_VERSION } from "@/lib/app-version";
import { requireViewer } from "@/lib/auth/viewer";
import { CURRENT_STATUSES } from "@/lib/orders/status";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

import { DeleteAccount, LogoutEverywhere } from "./account-sheets";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings");
  return { title: t("metaTitle") };
}

/**
 * Settings (N13, from Profile): language (Arabic only, disabled), Terms and
 * Privacy (N14), log out on all devices, and account deletion; the app
 * version at the end. No tab bar.
 */
export default async function SettingsPage() {
  const t = await getTranslations("Settings");
  return (
    <Screen className="bg-bg">
      <header className="flex items-center gap-3 px-5 pt-4.5 pb-3.5">
        <BackButton href={routes.profile} />
        <h1 className="flex-1 text-22 font-black">{t("title")}</h1>
      </header>
      <div className="flex flex-col gap-4 px-4 pb-safe-6">
        <Card className="overflow-hidden">
          <ul className="divide-y divide-divider">
            <li className="flex min-h-14 items-center gap-3 px-4">
              <Languages aria-hidden className="size-6 shrink-0 text-teal" strokeWidth={2} />
              <span className="flex flex-1 flex-col">
                <span className="text-17 font-extrabold">{t("language")}</span>
                <span className="text-13 text-muted">{t("languageSoon")}</span>
              </span>
              <span className="text-15 text-muted">{t("languageValue")}</span>
            </li>
            <li>
              <LinkRow href={`${routes.terms}?from=settings`} icon={FileText} label={t("terms")} />
            </li>
            <li>
              <LinkRow
                href={`${routes.privacy}?from=settings`}
                icon={ShieldCheck}
                label={t("privacy")}
              />
            </li>
          </ul>
        </Card>
        <Suspense fallback={<Skeleton className="h-28 w-full rounded-card" />}>
          <AccountCard />
        </Suspense>
        <p className="text-center text-13 text-muted">
          {t.rich("version", {
            version: APP_VERSION,
            num: (chunks) => <span dir="ltr">{chunks}</span>,
          })}
        </p>
      </div>
    </Screen>
  );
}

async function AccountCard() {
  await requireViewer(routes.settings);
  const supabase = await createClient();
  // Deletion is refused while an order is open (ZL039); say so up front.
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("status", CURRENT_STATUSES);
  if (error) throw new Error(`Open orders count failed: ${error.message}`);

  return (
    <Card className="overflow-hidden">
      <div className="divide-y divide-divider">
        <LogoutEverywhere />
        <DeleteAccount hasOpenOrders={(count ?? 0) > 0} />
      </div>
    </Card>
  );
}

function LinkRow({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link href={href} className="flex min-h-14 w-full items-center gap-3 px-4 text-start">
      <Icon aria-hidden className="size-6 shrink-0 text-teal" strokeWidth={2} />
      <span className="flex-1 text-17 font-extrabold">{label}</span>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-control-off rtl:-scale-x-100" />
    </Link>
  );
}
