import Link from "next/link";
import { useTranslations } from "next-intl";

import type { ArticleSummary } from "@/lib/articles/queries";
import { routes } from "@/lib/routes";

import { CategoryGlyph } from "./category-icon";

/**
 * An article in the Tips list (Tips.dc.html): the category's icon tile,
 * "category · read time" and the title. The whole card opens Article (N9).
 */
export function ArticleRow({ article }: { article: ArticleSummary }) {
  const t = useTranslations("Tips");
  return (
    <Link
      href={routes.article(article.slug)}
      className="flex items-center gap-3 rounded-button border border-border bg-surface p-3 text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
    >
      <span className="flex size-14 shrink-0 items-center justify-center rounded-input bg-selected text-teal">
        <CategoryGlyph icon={article.category.icon} className="size-6.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-12 font-bold text-teal">
          {t("meta", {
            category: article.category.name,
            time: t("readTime", { minutes: article.readMinutes }),
          })}
        </span>
        <span className="text-15 leading-normal font-extrabold">{article.title}</span>
      </span>
    </Link>
  );
}
