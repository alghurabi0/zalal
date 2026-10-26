import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { adminLiveMap } from "@/lib/admin/live-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";

import { LiveMap } from "./live-map";

/**
 * Live map (A3, spec §8.2): every crew on the way, with its order, the age
 * of its last position and its distance to the customer. Positions arrive
 * through Realtime; the admin shell (AdminLive) reloads the list when an
 * order sets off or arrives.
 */
export default async function LivePage() {
  const t = await getTranslations("Admin.liveMap");
  return (
    <AdminPage title={t("title")}>
      <p className="max-w-3xl text-15 text-body-2">{t("intro")}</p>
      <Suspense
        fallback={
          <SkeletonGroup className="flex flex-col gap-3">
            <Skeleton className="h-96 rounded-card" />
            <Skeleton className="h-40 rounded-card" />
          </SkeletonGroup>
        }
      >
        <Live />
      </Suspense>
    </AdminPage>
  );
}

async function Live() {
  await requireViewer(routes.adminLive, "admin");
  const data = await adminLiveMap();
  return <LiveMap data={data} />;
}
