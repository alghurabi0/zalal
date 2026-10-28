import { z } from "zod";

import { CATEGORY_ICONS } from "@/lib/articles/category-icons";

import { cleanText } from "./profile";

// What A11's forms send to their Server Actions (spec §8.2). The admin RPCs
// and the table checks (migration articles) validate everything again.

export const SLUG_MAX = 80;
export const TITLE_MAX = 120;
export const BODY_MAX = 20_000;
export const CATEGORY_NAME_MAX = 30;

/** A Latin slug the admin types: a-z, 0-9 and single hyphens (settled Oct 28, 2026). */
export const slugSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(
    z
      .string()
      .min(3, "too_short")
      .max(SLUG_MAX, "too_long")
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "invalid"),
  );

export const articleTitleSchema = z
  .string()
  .transform(cleanText)
  .pipe(z.string().min(5, "too_short").max(TITLE_MAX, "too_long"));

export const coverPathSchema = z.string().regex(/^articles\/[^/]+$/);

export const saveArticleSchema = z
  .object({
    id: z.uuid().nullable(),
    slug: slugSchema,
    title: articleTitleSchema,
    categoryId: z.number().int().positive(),
    coverPath: coverPathSchema.nullable(),
    body: z.string().max(BODY_MAX, "too_long"),
    featured: z.boolean(),
    status: z.enum(["draft", "published"]),
  })
  .refine((article) => article.status === "draft" || /\S/.test(article.body), {
    path: ["body"],
    message: "required",
  });
export type SaveArticleInput = z.input<typeof saveArticleSchema>;

export const deleteArticleSchema = z.object({ id: z.uuid() });

export const categoryNameSchema = z
  .string()
  .transform(cleanText)
  .pipe(z.string().min(2, "too_short").max(CATEGORY_NAME_MAX, "too_long"));

export const saveCategorySchema = z.object({
  id: z.number().int().positive().nullable(),
  name: categoryNameSchema,
  icon: z.enum(CATEGORY_ICONS),
});
export type SaveCategoryInput = z.input<typeof saveCategorySchema>;

export const deleteCategorySchema = z.object({ id: z.number().int().positive() });

export const reorderCategoriesSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
});
