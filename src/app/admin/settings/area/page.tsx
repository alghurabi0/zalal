import { ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { adminServiceAreas } from "@/lib/admin/catalog-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";

import { AreaEditor } from "./area-editor";

/**
 * The service-area editor (A13, spec §8.2, §5.4). With a Google Maps key the
 * areas are edited on the map; without one (local, CI) the editor shows a
 * drawn preview and edits by GeoJSON import. Both export GeoJSON.
 */
export default async function ServiceAreaPage() {
  const t = await getTranslations("Admin.area");
  return (
    <AdminPage
      title={t("title")}
      actions={
        <Button href={routes.adminSettings} variant="secondary" size="sm">
          <ChevronRight aria-hidden className="size-4" />
          {t("back")}
        </Button>
      }
    >
      <p className="max-w-3xl text-15 text-body-2">{t("intro")}</p>
      <Suspense
        fallback={
          <SkeletonGroup className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-72 rounded-card" />
            <Skeleton className="h-72 rounded-card" />
          </SkeletonGroup>
        }
      >
        <Areas />
      </Suspense>
    </AdminPage>
  );
}

async function Areas() {
  await requireViewer(routes.adminServiceArea, "admin");
  const { areas, addressesOutside } = await adminServiceAreas();
  return <AreaEditor areas={areas} addressesOutside={addressesOutside} />;
}
