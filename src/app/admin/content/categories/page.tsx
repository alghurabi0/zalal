import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { adminCategories } from "@/lib/admin/content-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";

import { BackToContent } from "../editor-frame";
import { CategoryList } from "./category-list";

/**
 * Article categories (A11, spec §8.2): their order on Tips, name and icon;
 * add, rename, move up or down, and delete one no article uses.
 */
export default async function CategoriesPage() {
  const t = await getTranslations("Admin.content.categoriesPage");
  return (
    <AdminPage title={t("title")} actions={<BackToContent />}>
      <p className="max-w-3xl text-15 text-body-2">{t("intro")}</p>
      <Suspense
        fallback={
          <SkeletonGroup className="flex flex-col gap-3">
            <Skeleton className="h-64 rounded-card" />
            <Skeleton className="h-11 w-32 rounded-button" />
          </SkeletonGroup>
        }
      >
        <Categories />
      </Suspense>
    </AdminPage>
  );
}

async function Categories() {
  await requireViewer(routes.adminCategories, "admin");
  return <CategoryList categories={await adminCategories()} />;
}
