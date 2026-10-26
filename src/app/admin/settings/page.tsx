import { Map as MapIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { adminSettings } from "@/lib/admin/catalog-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";

import { SettingsForms } from "./settings-forms";

/**
 * Settings (A13, spec §8.2, §7): each section saves on its own. The support
 * response text and the subscription plan come with Phases 5 and 6, and
 * maintenance mode and the minimum app version with N16 (Phase 6), which is
 * what reads them.
 */
export default async function SettingsPage() {
  const t = await getTranslations("Admin.settings");
  return (
    <AdminPage title={t("title")}>
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-well text-teal">
          <MapIcon aria-hidden className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-16 font-extrabold">{t("area.title")}</span>
          <span className="text-13 text-muted">{t("area.body")}</span>
        </span>
        <Button href={routes.adminServiceArea} variant="secondary" size="sm">
          {t("area.open")}
        </Button>
      </Card>
      <Suspense
        fallback={
          <SkeletonGroup className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-56 rounded-card" />
            ))}
          </SkeletonGroup>
        }
      >
        <Settings />
      </Suspense>
    </AdminPage>
  );
}

async function Settings() {
  await requireViewer(routes.adminSettings, "admin");
  const settings = await adminSettings();
  // Not keyed by the saved values: a save refreshes the page, and each
  // section keeps what was typed and its "saved" note.
  return <SettingsForms settings={settings} />;
}
