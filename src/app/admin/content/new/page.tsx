import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AdminPage } from "@/components/admin/admin-page";
import { adminCategories } from "@/lib/admin/content-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";

import { ArticleEditor } from "../article-editor";
import { BackToContent, EditorSkeleton } from "../editor-frame";

/** A new article (A11): saved as a draft or published at once. */
export default async function NewArticlePage() {
  const t = await getTranslations("Admin.content.editor");
  return (
    <AdminPage title={t("newTitle")} actions={<BackToContent />}>
      <Suspense fallback={<EditorSkeleton />}>
        <NewArticle />
      </Suspense>
    </AdminPage>
  );
}

async function NewArticle() {
  await requireViewer(routes.adminNewArticle, "admin");
  const categories = await adminCategories();
  return <ArticleEditor article={null} categories={categories} />;
}
