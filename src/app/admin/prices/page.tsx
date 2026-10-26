import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { adminPrices } from "@/lib/admin/catalog-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";

import { PriceForm } from "./price-form";

/** Prices (A8, spec §8.2): the six cells, roof and ground × small, medium, large. */
export default async function PricesPage() {
  const t = await getTranslations("Admin.prices");
  return (
    <AdminPage title={t("title")}>
      <p className="max-w-3xl text-15 text-body-2">{t("intro")}</p>
      <Suspense
        fallback={
          <SkeletonGroup>
            <Skeleton className="h-64 max-w-3xl rounded-card" />
          </SkeletonGroup>
        }
      >
        <Prices />
      </Suspense>
    </AdminPage>
  );
}

async function Prices() {
  await requireViewer(routes.adminPrices, "admin");
  const prices = await adminPrices();
  return <PriceForm prices={prices} />;
}
