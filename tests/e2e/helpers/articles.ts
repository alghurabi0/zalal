import { randomBytes } from "node:crypto";

import { admin } from "./supabase";

// Tips test data (spec §5.6, N9, A11), written with the secret key. Tests run
// in parallel against one database with the seeded articles published, so
// tests make their own categories and articles and never feature one (that
// would change Tips' top card and Home's strip for every other test).

const suffix = () => randomBytes(4).toString("hex");

/** A new category at the end of the order. */
export async function createCategory(name = `قسم ${suffix()}`) {
  const { data } = await admin
    .from("article_categories")
    .insert({ name, icon: "shield", sort: 1000 })
    .select("id, name")
    .single()
    .throwOnError();
  return data;
}

/** A new, not featured article; published unless `status` says otherwise. */
export async function createArticle({
  categoryId,
  status = "published",
  title = `مقال للتجربة ${suffix()}`,
  body = "## عنوان\n\nنص المقال **للتجربة**.\n\n1. أول\n2. ثاني",
}: {
  categoryId: number;
  status?: "draft" | "published";
  title?: string;
  body?: string;
}) {
  const { data } = await admin
    .from("articles")
    .insert({
      slug: `e2e-${suffix()}`,
      title,
      category_id: categoryId,
      body_md: body,
      status,
      published_at: status === "published" ? new Date().toISOString() : null,
    })
    .select("id, slug, title")
    .single()
    .throwOnError();
  return data;
}
