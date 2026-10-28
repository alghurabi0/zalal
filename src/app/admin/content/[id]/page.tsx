import { Newspaper } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { AdminPage } from "@/components/admin/admin-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { adminArticle, adminCategories } from "@/lib/admin/content-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";

import { ArticleEditor } from "../article-editor";
import { BackToContent, EditorSkeleton } from "../editor-frame";

/** One article in A11's editor. */
export default async function EditArticlePage(props: PageProps<"/admin/content/[id]">) {
  const t = await getTranslations("Admin.content.editor");
  return (
    <AdminPage title={t("editTitle")} actions={<BackToContent />}>
      <Suspense fallback={<EditorSkeleton />}>
        <EditArticle {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function EditArticle({ params }: PageProps<"/admin/content/[id]">) {
  const { id } = await params;
  await requireViewer(routes.adminArticle(id), "admin");
  const t = await getTranslations("Admin.content.editor");
  const articleId = z.uuid().safeParse(id);
  const [article, categories] = await Promise.all([
    articleId.success ? adminArticle(articleId.data) : null,
    adminCategories(),
  ]);

  if (!article) {
    return (
      <Card className="py-6">
        <EmptyState
          icon={Newspaper}
          title={t("notFoundTitle")}
          description={t("notFoundBody")}
          action={
            <Button href={routes.adminContent} size="sm">
              {t("back")}
            </Button>
          }
        />
      </Card>
    );
  }
  // Keyed by the article, so moving between articles starts a fresh form.
  return <ArticleEditor key={article.id} article={article} categories={categories} />;
}
