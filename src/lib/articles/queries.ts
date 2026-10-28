import "server-only";

import { cache } from "react";

import type { CategoryIcon } from "@/lib/articles/category-icons";
import { createClient } from "@/lib/supabase/server";

// Reads for Tips, Article (N9) and Home's tips strip (spec §5.5, §5.6, N9).
// RLS shows guests, customers and crews published articles only; these
// filter on status too, so admins see what customers see.

export type ArticleCategory = { id: number; name: string; icon: CategoryIcon };

export type ArticleSummary = {
  id: string;
  slug: string;
  title: string;
  readMinutes: number;
  featured: boolean;
  publishedAt: string;
  category: ArticleCategory;
};

export type PublishedArticle = ArticleSummary & { bodyMd: string; coverUrl: string | null };

const summaryColumns =
  "id, slug, title, read_minutes, featured, published_at, category:article_categories!inner(id, name, icon)";

type SummaryRow = {
  id: string;
  slug: string;
  title: string;
  // Generated, so the types allow null; the column never is.
  read_minutes: number | null;
  featured: boolean;
  published_at: string | null;
  category: { id: number; name: string; icon: CategoryIcon };
};

function toSummary(row: SummaryRow): ArticleSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    readMinutes: row.read_minutes ?? 1,
    featured: row.featured,
    // A published article always has one (articles_published_check).
    publishedAt: row.published_at ?? "",
    category: row.category,
  };
}

/** Every published article, newest first, and the categories in their order. */
export async function listPublishedArticles(): Promise<{
  articles: ArticleSummary[];
  categories: ArticleCategory[];
}> {
  const supabase = await createClient();
  const [articles, categories] = await Promise.all([
    supabase
      .from("articles")
      .select(summaryColumns)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .order("id")
      .limit(200),
    supabase.from("article_categories").select("id, name, icon").order("sort").order("id"),
  ]);
  if (articles.error) throw new Error(`Articles read failed: ${articles.error.message}`);
  if (categories.error) throw new Error(`Categories read failed: ${categories.error.message}`);
  return { articles: articles.data.map(toSummary), categories: categories.data };
}

/** articles.slug's format; anything else can't be an article. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** One published article by its slug, or null. Once per request (page and metadata). */
export const publishedArticle = cache(async (slug: string): Promise<PublishedArticle | null> => {
  if (!SLUG_PATTERN.test(slug) || slug.length > 80) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("articles")
    .select(`${summaryColumns}, body_md, cover_path`)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new Error(`Article read failed: ${error.message}`);
  if (!data) return null;
  return {
    ...toSummary(data),
    bodyMd: data.body_md,
    coverUrl: data.cover_path
      ? supabase.storage.from("public-content").getPublicUrl(data.cover_path).data.publicUrl
      : null,
  };
});

/** A published article's Markdown body, or null. */
export async function articleBody(id: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("articles")
    .select("body_md")
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new Error(`Article read failed: ${error.message}`);
  return data?.body_md ?? null;
}

/** Home's strip (§5.5). */
export const HOME_TIPS = 2;

/** The 2 newest featured articles, filled with the newest others (settled Oct 28, 2026). */
export async function homeArticles(): Promise<ArticleSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("articles")
    .select(summaryColumns)
    .eq("status", "published")
    .order("featured", { ascending: false })
    .order("published_at", { ascending: false })
    .order("id")
    .limit(HOME_TIPS);
  if (error) throw new Error(`Articles read failed: ${error.message}`);
  return data.map(toSummary);
}

/** Tips' top card (§5.6): the newest featured article. */
export function topArticle(articles: ArticleSummary[]): ArticleSummary | null {
  return articles.find((article) => article.featured) ?? null;
}
