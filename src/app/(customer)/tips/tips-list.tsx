"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ArticleRow } from "@/components/articles/article-row";
import { Chip, ChipGroup } from "@/components/ui/chip";
import type { ArticleHighlights } from "@/lib/articles/highlights";
import type { ArticleCategory, ArticleSummary } from "@/lib/articles/queries";
import { routes } from "@/lib/routes";

type Top = { article: ArticleSummary; highlights: ArticleHighlights };

/**
 * Tips' chips, top card and list (Tips.dc.html). A chip filters the list;
 * the top card shows only while its category is picked or under الكل.
 */
export function TipsList({
  categories,
  articles,
  top,
}: {
  categories: ArticleCategory[];
  articles: ArticleSummary[];
  top: Top | null;
}) {
  const t = useTranslations("Tips");
  const [picked, setPicked] = useState<number | null>(null);
  const inPicked = (article: ArticleSummary) => picked === null || article.category.id === picked;
  const list = articles.filter((article) => article.id !== top?.article.id && inPicked(article));
  const showTop = top && inPicked(top.article);

  return (
    <>
      <ChipGroup
        legend={t("categories")}
        legendClassName="sr-only"
        // A fieldset is as wide as its content unless told otherwise.
        className="min-w-0"
        // Scrolls sideways when the chips don't fit (§10.2 seeds a fourth category).
        bodyClassName="flex-nowrap gap-2 overflow-x-auto px-5 pt-1 pb-3"
      >
        {[{ id: null, name: t("all") }, ...categories].map((category) => (
          <Chip
            key={category.id ?? "all"}
            type="radio"
            variant="pill"
            name="category"
            value={category.id ?? ""}
            checked={picked === category.id}
            onChange={() => setPicked(category.id)}
            className="h-9.5 shrink-0 px-3.5 whitespace-nowrap"
          >
            {category.name}
          </Chip>
        ))}
      </ChipGroup>

      <div className="flex flex-col gap-3 px-4 pb-6">
        {showTop && <TopCard top={top} />}
        {list.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {list.map((article) => (
              <li key={article.id}>
                <ArticleRow article={article} />
              </li>
            ))}
          </ul>
        ) : (
          !showTop && <p className="py-6 text-center text-15 text-muted">{t("emptyCategory")}</p>
        )}
      </div>
    </>
  );
}

/** مقال اليوم: navy, with the article's numbered points or its first paragraph. */
function TopCard({ top: { article, highlights } }: { top: Top }) {
  const t = useTranslations("Tips");
  return (
    <Link
      href={routes.article(article.slug)}
      className="flex flex-col gap-2.5 rounded-20 bg-navy p-4.5 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
    >
      <span className="text-12 font-extrabold text-aqua">
        {t("meta", {
          category: t("featured"),
          time: t("readTime", { minutes: article.readMinutes }),
        })}
      </span>
      <span className="text-19 leading-normal font-black">{article.title}</span>
      {highlights?.kind === "list" && (
        <ol className="flex flex-col gap-1.5">
          {highlights.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span
                aria-hidden
                className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-navy-2 text-12 font-extrabold text-aqua"
              >
                {i + 1}
              </span>
              <span className="line-clamp-2 text-14 leading-relaxed text-on-dark-body">{item}</span>
            </li>
          ))}
        </ol>
      )}
      {highlights?.kind === "text" && (
        <p className="line-clamp-3 text-14 leading-relaxed text-on-dark-body">{highlights.text}</p>
      )}
    </Link>
  );
}
