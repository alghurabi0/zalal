import { LayoutDashboard } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { SurfacePlaceholder } from "@/components/layout/surface-placeholder";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { routes } from "@/lib/routes";

/** The admin surface (spec §8), a placeholder until Phase 3. */
export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <SkeletonGroup className="mx-auto flex min-h-dvh max-w-phone flex-col items-center justify-center gap-4 px-8">
          <Skeleton className="size-22 rounded-full" />
          <Skeleton className="h-7 w-48" />
        </SkeletonGroup>
      }
    >
      <Content />
    </Suspense>
  );
}

async function Content() {
  const t = await getTranslations("Placeholder");
  return (
    <SurfacePlaceholder
      role="admin"
      path={routes.admin}
      icon={LayoutDashboard}
      title={t("adminTitle")}
      body={t("adminBody")}
    />
  );
}
