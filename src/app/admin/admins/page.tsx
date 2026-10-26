import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { adminAccounts } from "@/lib/admin/staff-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";

import { AdminList } from "./admin-list";

/**
 * Admins (A14, spec §8.2): add an admin by phone (a new number, or any
 * customer account) and remove one. Nobody removes themselves.
 */
export default async function AdminsPage() {
  const t = await getTranslations("Admin.admins");
  return (
    <AdminPage title={t("title")}>
      <p className="max-w-3xl text-15 text-body-2">{t("intro")}</p>
      <Suspense
        fallback={
          <SkeletonGroup className="flex flex-col gap-3">
            <Skeleton className="h-48 rounded-card" />
            <Skeleton className="h-11 w-32 rounded-button" />
          </SkeletonGroup>
        }
      >
        <Admins />
      </Suspense>
    </AdminPage>
  );
}

async function Admins() {
  const viewer = await requireViewer(routes.adminAdmins, "admin");
  const admins = await adminAccounts();
  return <AdminList admins={admins} viewerId={viewer.id} />;
}
