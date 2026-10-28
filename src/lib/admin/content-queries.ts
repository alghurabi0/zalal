import "server-only";

import type { CategoryIcon } from "@/lib/articles/category-icons";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

// Reads for A11 (spec §8.2). Admins read drafts through RLS; every page
// checks the role first with requireViewer(…, "admin").

export type ArticleStatus = Database["public"]["Enums"]["article_status"];
export const ARTICLE_STATUSES = ["published", "draft"] as const satisfies ArticleStatus[];

export type AdminArticleRow = {
  id: string;
  slug: string;
  title: string;
  status: ArticleStatus;
  featured: boolean;
  updatedAt: string;
  category: string;
};

export async function adminArticles(status?: ArticleStatus): Promise<AdminArticleRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("articles")
    .select(
      "id, slug, title, status, featured, updated_at, category:article_categories!inner(name)",
    )
    .order("updated_at", { ascending: false })
    .limit(500);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`Articles read failed: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    featured: row.featured,
    updatedAt: row.updated_at,
    category: row.category.name,
  }));
}

export type AdminArticle = {
  id: string;
  slug: string;
  title: string;
  categoryId: number;
  coverPath: string | null;
  coverUrl: string | null;
  body: string;
  featured: boolean;
  status: ArticleStatus;
  publishedAt: string | null;
};

export async function adminArticle(id: string): Promise<AdminArticle | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("articles")
    .select("id, slug, title, category_id, cover_path, body_md, featured, status, published_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Article read failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    categoryId: data.category_id,
    coverPath: data.cover_path,
    coverUrl: data.cover_path ? coverUrl(supabase, data.cover_path) : null,
    body: data.body_md,
    featured: data.featured,
    status: data.status,
    publishedAt: data.published_at,
  };
}

function coverUrl(supabase: Awaited<ReturnType<typeof createClient>>, path: string): string {
  return supabase.storage.from("public-content").getPublicUrl(path).data.publicUrl;
}

export type AdminCategory = {
  id: number;
  name: string;
  icon: CategoryIcon;
  articles: number;
};

/** The categories in their order, each with how many articles use it. */
export async function adminCategories(): Promise<AdminCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("article_categories")
    .select("id, name, icon, articles(count)")
    .order("sort")
    .order("id");
  if (error) throw new Error(`Categories read failed: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    icon: row.icon,
    articles: row.articles[0]?.count ?? 0,
  }));
}
