import { Wrench } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { SystemState } from "@/components/layout/system-state";
import { Skeleton } from "@/components/ui/skeleton";
import { companyPhones } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

import { RetryButton } from "./retry-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("System");
  return { title: t("maintenanceMeta"), robots: { index: false } };
}

/**
 * N16 maintenance. proxy.ts shows it at the customer's own URL while
 * A13's maintenance switch is on; "حاول مرة ثانية" reloads that URL.
 */
export default function MaintenancePage() {
  return (
    <Suspense fallback={<Skeleton className="min-h-dvh w-full" />}>
      <Maintenance />
    </Suspense>
  );
}

async function Maintenance() {
  const t = await getTranslations("System");
  const supabase = await createClient();
  const { data } = await supabase
    .from("settings")
    .select("company_phone, company_phone_2")
    .single();
  return (
    <SystemState
      icon={Wrench}
      title={t("maintenanceTitle")}
      body={t("maintenanceBody")}
      phones={data ? companyPhones(data) : []}
      callLabel={t("call")}
      action={<RetryButton label={t("retry")} />}
    />
  );
}
