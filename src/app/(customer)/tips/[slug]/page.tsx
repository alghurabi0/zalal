import { Newspaper } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { CategoryGlyph } from "@/components/articles/category-icon";
import { MarkdownText } from "@/components/articles/markdown";
import { Screen } from "@/components/layout/screen";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { publishedArticle } from "@/lib/articles/queries";
import { formatDate } from "@/lib/dates";
import { routes } from "@/lib/routes";

export async function generateMetadata({ params }: PageProps<"/tips/[slug]">): Promise<Metadata> {
  const article = await publishedArticle((await params).slug);
  const t = await getTranslations("Tips");
  return { title: article?.title ?? t("metaTitle") };
}

/**
 * Article (N9), guests too: the cover (or the category's icon on a soft
 * block when there is none), category and read time, title, publish date,
 * the Markdown body, and "احجز تنظيف" at the bottom (guests go through
 * login). Published articles only, admins included. No tab bar (§5).
 */
export default function ArticlePage(props: PageProps<"/tips/[slug]">) {
  return (
    <Screen className="bg-bg">
      <header className="flex items-center px-5 pt-4.5 pb-3">
        <BackButton href={routes.tips} />
      </header>
      <Suspense fallback={<ArticleSkeleton />}>
        <ArticleContent {...props} />
      </Suspense>
    </Screen>
  );
}

async function ArticleContent({ params }: PageProps<"/tips/[slug]">) {
  const article = await publishedArticle((await params).slug);
  const t = await getTranslations("Article");
  const tTips = await getTranslations("Tips");

  if (!article) {
    return (
      <EmptyState
        icon={Newspaper}
        title={t("notFoundTitle")}
        titleAs="h1"
        description={t("notFoundBody")}
        action={
          <Button href={routes.tips} size="footer" className="w-full">
            {t("notFoundAction")}
          </Button>
        }
      />
    );
  }

  return (
    <>
      <article className="flex flex-1 flex-col gap-4 px-5 pb-6">
        {article.coverUrl ? (
          // A public file of any size: a plain <img>, sized by the box.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={article.coverUrl}
            alt=""
            className="aspect-video w-full rounded-card bg-selected object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-36 items-center justify-center rounded-card bg-selected text-teal"
          >
            <CategoryGlyph icon={article.category.icon} className="size-14" />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-13 font-bold text-teal">
            {tTips("meta", {
              category: article.category.name,
              time: tTips("readTime", { minutes: article.readMinutes }),
            })}
          </span>
          <h1 className="text-24 leading-snug font-black">{article.title}</h1>
          <span className="text-13 text-muted">
            {t("published", { date: formatDate(article.publishedAt) })}
          </span>
        </div>
        <MarkdownText>{article.bodyMd}</MarkdownText>
      </article>
      <footer className="sticky bottom-0 z-10 border-t border-border bg-surface px-5 pt-3 pb-safe-5.5">
        <Button href={routes.book} size="footer" className="w-full">
          {t("book")}
        </Button>
      </footer>
    </>
  );
}

function ArticleSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4 px-5">
      <Skeleton className="h-36 rounded-card" />
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-4/5" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </SkeletonGroup>
  );
}
