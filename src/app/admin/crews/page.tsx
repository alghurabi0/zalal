import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { adminCrews } from "@/lib/admin/staff-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";

import { CrewList } from "./crew-list";

/**
 * Crews (A10, spec §8.2): create a crew with a new phone, rename it, switch
 * it on or off, or move it to another phone.
 */
export default async function CrewsPage() {
  const t = await getTranslations("Admin.crews");
  return (
    <AdminPage title={t("title")}>
      <p className="max-w-3xl text-15 text-body-2">{t("intro")}</p>
      <Suspense
        fallback={
          <SkeletonGroup className="flex flex-col gap-3">
            <Skeleton className="h-64 rounded-card" />
            <Skeleton className="h-11 w-32 rounded-button" />
          </SkeletonGroup>
        }
      >
        <Crews />
      </Suspense>
    </AdminPage>
  );
}

async function Crews() {
  await requireViewer(routes.adminCrews, "admin");
  const crews = await adminCrews();
  return <CrewList crews={crews} />;
}
