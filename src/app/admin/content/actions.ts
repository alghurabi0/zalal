"use server";

import * as Sentry from "@sentry/nextjs";

import { type AdminEditFailure, editFailure } from "@/lib/admin/edit-errors";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import {
  deleteArticleSchema,
  deleteCategorySchema,
  reorderCategoriesSchema,
  type SaveArticleInput,
  saveArticleSchema,
  type SaveCategoryInput,
  saveCategorySchema,
} from "@/lib/schemas/article";
import { createClient } from "@/lib/supabase/server";

// A11's actions (spec §8.2). The RPCs, called as the admin, check the role
// and write the audit log. Covers the RPCs free are deleted through the
// admin's own Storage client, never the secret key: its delete policy
// refuses a cover another article took meanwhile (RLS audit).

const report = (message: string) => Sentry.captureMessage(message, "error");

async function admin() {
  await requireViewer(routes.adminContent, "admin");
  return createClient();
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Best effort: a cover left behind is deleted by the nightly cleanup. */
async function removeCover(supabase: Supabase, path: string | null) {
  if (!path) return;
  const { error } = await supabase.storage.from("public-content").remove([path]);
  if (error) report("article cover delete failed");
}

export async function saveArticle(
  input: SaveArticleInput,
): Promise<{ status: "done"; id: string } | AdminEditFailure> {
  const parsed = saveArticleSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const article = parsed.data;
  const supabase = await admin();
  const { data, error } = await supabase
    .rpc("admin_save_article", {
      p_id: article.id ?? undefined,
      p_slug: article.slug,
      p_title: article.title,
      p_category_id: article.categoryId,
      p_cover_path: article.coverPath ?? undefined,
      p_body_md: article.body,
      p_featured: article.featured,
      p_status: article.status,
    })
    .single();
  if (error) return editFailure("admin_save_article", error, report);
  // Typed as a string by the generator; null when no cover was replaced.
  await removeCover(supabase, data.replaced_cover ?? null);
  return { status: "done", id: data.article_id };
}

export async function deleteArticle(input: {
  id: string;
}): Promise<{ status: "done" } | AdminEditFailure> {
  const parsed = deleteArticleSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await admin();
  const { data, error } = await supabase.rpc("admin_delete_article", { p_id: parsed.data.id });
  if (error) return editFailure("admin_delete_article", error, report);
  await removeCover(supabase, data);
  return { status: "done" };
}

/** A cover uploaded in the editor but replaced before saving. */
export async function discardCover(input: { path: string }): Promise<{ status: "done" }> {
  const supabase = await admin();
  const path = /^articles\/[^/]+$/.test(input.path) ? input.path : null;
  // The delete policy refuses a cover an article uses.
  await removeCover(supabase, path);
  return { status: "done" };
}

export async function saveCategory(
  input: SaveCategoryInput,
): Promise<{ status: "done" } | AdminEditFailure> {
  const parsed = saveCategorySchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await admin();
  const { error } = await supabase.rpc("admin_save_category", {
    p_id: parsed.data.id ?? undefined,
    p_name: parsed.data.name,
    p_icon: parsed.data.icon,
  });
  return error ? editFailure("admin_save_category", error, report) : { status: "done" };
}

export async function deleteCategory(input: {
  id: number;
}): Promise<{ status: "done" } | AdminEditFailure> {
  const parsed = deleteCategorySchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await admin();
  const { error } = await supabase.rpc("admin_delete_category", { p_id: parsed.data.id });
  return error ? editFailure("admin_delete_category", error, report) : { status: "done" };
}

export async function reorderCategories(input: {
  ids: number[];
}): Promise<{ status: "done" } | AdminEditFailure> {
  const parsed = reorderCategoriesSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await admin();
  const { error } = await supabase.rpc("admin_reorder_categories", { p_ids: parsed.data.ids });
  return error ? editFailure("admin_reorder_categories", error, report) : { status: "done" };
}
