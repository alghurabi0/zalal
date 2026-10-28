import { FolderTree, Newspaper, Plus, Star } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { AdminPage } from "@/components/admin/admin-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { adminArticles, ARTICLE_STATUSES } from "@/lib/admin/content-queries";
import { requireViewer } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { formatDayTime } from "@/lib/dates";
import { routes } from "@/lib/routes";

import { ArticleStatusBadge } from "./status-badge";

const querySchema = z.object({
  status: z.enum(ARTICLE_STATUSES).optional().catch(undefined),
});

/**
 * Content (A11, spec §8.2): every article, last edited first, filtered by
 * status (`?status=`), with links to the editor, a new article and the
 * categories.
 */
export default async function ContentPage(props: PageProps<"/admin/content">) {
  const t = await getTranslations("Admin.content");
  return (
    <AdminPage
      title={t("title")}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button href={routes.adminCategories} variant="secondary" size="sm">
            <FolderTree aria-hidden className="size-4" />
            {t("categories")}
          </Button>
          <Button href={routes.adminNewArticle} size="sm">
            <Plus aria-hidden className="size-4" />
            {t("newArticle")}
          </Button>
        </div>
      }
    >
      <p className="max-w-3xl text-15 text-body-2">{t("intro")}</p>
      <Suspense
        fallback={
          <SkeletonGroup className="flex flex-col gap-3">
            <Skeleton className="h-11 w-64 rounded-button" />
            <Skeleton className="h-96 rounded-card" />
          </SkeletonGroup>
        }
      >
        <Articles {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Articles({ searchParams }: PageProps<"/admin/content">) {
  await requireViewer(routes.adminContent, "admin");
  const t = await getTranslations("Admin.content");
  const raw = await searchParams;
  const { status } = querySchema.parse({
    status: Array.isArray(raw.status) ? raw.status[0] : raw.status,
  });
  const articles = await adminArticles(status);
  const filters = [undefined, ...ARTICLE_STATUSES];

  return (
    <>
      <nav aria-label={t("filterLabel")}>
        <ul className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <li key={filter ?? "all"}>
              <Link
                href={filter ? `${routes.adminContent}?status=${filter}` : routes.adminContent}
                aria-current={filter === status ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full border-2 px-4 text-14 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
                  filter === status
                    ? "border-navy bg-navy text-white"
                    : "border-border bg-surface text-muted",
                )}
              >
                {filter ? t(`status.${filter}`) : t("all")}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {articles.length === 0 ? (
        <Card className="py-6">
          <EmptyState
            icon={Newspaper}
            title={status ? t("emptyFilteredTitle") : t("emptyTitle")}
            description={status ? undefined : t("emptyBody")}
            action={
              status ? (
                <Link
                  href={routes.adminContent}
                  className="inline-flex min-h-11 items-center font-extrabold text-teal"
                >
                  {t("clearFilter")}
                </Link>
              ) : (
                <Button href={routes.adminNewArticle} size="sm">
                  {t("newArticle")}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-2xl text-14">
            <caption className="sr-only">{t("caption")}</caption>
            <thead className="bg-well text-13">
              <tr>
                {(
                  ["colTitle", "colCategory", "colStatus", "colFeatured", "colUpdated"] as const
                ).map((key) => (
                  <th key={key} scope="col" className="px-3 py-2.5 text-start font-bold text-muted">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {articles.map((article) => (
                <tr
                  key={article.id}
                  className="border-t border-divider"
                  data-testid={`article-${article.slug}`}
                >
                  <th scope="row" className="px-3 py-1 text-start">
                    <Link
                      href={routes.adminArticle(article.id)}
                      className="inline-flex min-h-11 items-center font-extrabold text-navy underline-offset-2 hover:text-teal hover:underline"
                    >
                      {article.title}
                    </Link>
                  </th>
                  <td className="px-3 py-3">{article.category}</td>
                  <td className="px-3 py-3">
                    <ArticleStatusBadge status={article.status} />
                  </td>
                  <td className="px-3 py-3">
                    {article.featured && (
                      <span className="inline-flex items-center gap-1 text-13 font-bold text-warn-icon">
                        <Star aria-hidden className="size-4 fill-current" />
                        {t("featured")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {formatDayTime(article.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
