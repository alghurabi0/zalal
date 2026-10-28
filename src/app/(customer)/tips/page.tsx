import { Newspaper } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { CustomerTabBar } from "@/components/chat/customer-tab-bar";
import { Screen } from "@/components/layout/screen";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { articleHighlights } from "@/lib/articles/highlights";
import { articleBody, listPublishedArticles, topArticle } from "@/lib/articles/queries";
import { routes } from "@/lib/routes";

import { TipsList } from "./tips-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Tips");
  return { title: t("metaTitle") };
}

/**
 * Tips (Tips.dc.html, spec §5.6), guests too: category chips from the
 * database with الكل first (only categories with published articles), the
 * newest featured article as the top card with its numbered points, then
 * every other article; each opens Article (N9). Tips keeps Home highlighted
 * in the tab bar (§5.18).
 */
export default async function TipsPage() {
  const t = await getTranslations("Tips");
  return (
    <Screen className="bg-bg">
      <header className="flex items-center gap-3 px-5 pt-4.5 pb-2.5">
        <BackButton href={routes.home} />
        <h1 className="text-22 font-black">{t("title")}</h1>
      </header>
      <div className="flex flex-1 flex-col">
        <Suspense fallback={<TipsSkeleton />}>
          <TipsContent />
        </Suspense>
      </div>
      <CustomerTabBar active="home" />
    </Screen>
  );
}

async function TipsContent() {
  const t = await getTranslations("Tips");
  const { articles, categories } = await listPublishedArticles();

  if (articles.length === 0) {
    return (
      <EmptyState
        icon={Newspaper}
        title={t("emptyTitle")}
        description={t("emptyBody")}
        action={
          <Button href={routes.book} size="footer" className="w-full">
            {t("emptyAction")}
          </Button>
        }
      />
    );
  }

  const top = topArticle(articles);
  const body = top ? await articleBody(top.id) : null;
  const used = new Set(articles.map((article) => article.category.id));

  return (
    <TipsList
      categories={categories.filter((category) => used.has(category.id))}
      articles={articles}
      top={top ? { article: top, highlights: body ? articleHighlights(body) : null } : null}
    />
  );
}

function TipsSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-3">
      <div className="flex gap-2 px-5 pb-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-9.5 w-16 rounded-full" />
        ))}
      </div>
      <div className="flex flex-col gap-3 px-4">
        <Skeleton className="h-60 rounded-20" />
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-button" />
        ))}
      </div>
    </SkeletonGroup>
  );
}
