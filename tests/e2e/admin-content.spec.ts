import { randomBytes } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { logInAsAdmin } from "./helpers/admin";
import { createArticle, createCategory } from "./helpers/articles";
import { screenshot } from "./helpers/auth";
import { admin } from "./helpers/supabase";

// Content (A11, spec §8.2): articles with a Markdown editor, preview and
// cover upload, draft or published; categories with their order. Tests make
// their own articles and categories (helpers/articles.ts) and never feature
// an article, so Tips and Home stay as the other tests expect.

const { Admin, Article } = messages;
const { content: Content, editErrors } = Admin;
const Editor = Content.editor;
const Categories = Content.categoriesPage;

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), text);

const categoryRow = (page: Page, name: string) =>
  page.getByRole("row").filter({ has: page.getByRole("rowheader", { name }) });

test("an admin writes an article with a cover, previews it, saves a draft and publishes it", async ({
  page,
  browser,
}) => {
  await logInAsAdmin(page);
  const category = await createCategory();
  const slug = `e2e-${randomBytes(4).toString("hex")}`;
  const title = `مقال من اللوحة ${slug.slice(-4)}`;

  await page
    .getByRole("navigation", { name: Admin.nav.label })
    .getByRole("link", { name: Admin.nav.content })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: Content.title })).toBeVisible();
  await page.getByRole("link", { name: Content.newArticle }).click();
  await expect(page).toHaveURL("/admin/content/new");

  await page.getByLabel(Editor.title, { exact: true }).fill(title);
  await page.getByLabel(Editor.slug, { exact: true }).fill(slug);
  await page.getByLabel(Editor.category).selectOption({ label: category.name });
  await page
    .getByRole("tabpanel")
    .getByRole("textbox")
    .fill("## قسم\n\nنص **غامق** و[رابط](javascript:alert(1)).\n\n1. أول\n2. ثاني");
  // The live read time (Admin.content.editor.readTime for one minute).
  await expect(page.getByText("1 دقيقة قراءة")).toBeVisible();

  // The cover: scaled to WebP in the browser and uploaded at once.
  await page.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/tank.jpg");
  await expect(page.getByRole("img", { name: Editor.coverPreview })).toBeVisible();
  await expect(page.getByRole("button", { name: Editor.coverReplace })).toBeEnabled();

  // Preview renders the Markdown; the unsafe link is only words.
  await page.getByRole("tab", { name: Editor.preview }).click();
  const preview = page.getByRole("tabpanel");
  await expect(preview.getByRole("heading", { level: 2, name: "قسم" })).toBeVisible();
  await expect(preview.locator("strong")).toHaveText("غامق");
  await expect(preview.getByRole("link")).toHaveCount(0);
  await expect(preview.getByText("رابط")).toBeVisible();
  await screenshot(page, "admin-content-editor");

  await page.getByRole("button", { name: Editor.saveDraft }).click();
  await expect(page).toHaveURL(/\/admin\/content\/[0-9a-f-]{36}$/);
  const { data: saved } = await admin
    .from("articles")
    .select("id, status, cover_path")
    .eq("slug", slug)
    .single()
    .throwOnError();
  expect(saved.status).toBe("draft");
  expect(saved.cover_path).toMatch(/^articles\/[0-9a-f-]+\.webp$/);

  // A guest can't see the draft.
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestPage = await guest.newPage();
  await guestPage.goto(`/tips/${slug}`);
  await expect(
    guestPage.getByRole("heading", { level: 1, name: Article.notFoundTitle }),
  ).toBeVisible();

  await page.getByRole("button", { name: Editor.publish }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(Editor.publishedDone);
  await expect(page.getByRole("link", { name: Editor.view })).toBeVisible();
  // Published: the slug is fixed.
  await expect(
    page.getByLabel(Editor.slug, { exact: true }).filter({ visible: true }),
  ).toHaveAttribute("readonly", "");

  await guestPage.goto(`/tips/${slug}`);
  await expect(guestPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(guestPage.locator("article img")).toHaveAttribute(
    "src",
    new RegExp(`${saved.cover_path}$`),
  );
  await guest.close();

  // The list and the audit log know it.
  await page.getByRole("link", { name: Editor.back }).click();
  await expect(page.getByTestId(`article-${slug}`)).toContainText(Content.status.published);
  await page.goto("/admin/audit?entity=articles");
  await expect(page.getByRole("row").filter({ hasText: title }).first()).toContainText(
    Admin.audit.actions.article.update,
  );
});

test("an admin moves an article back to draft, then deletes it with its cover", async ({
  page,
}) => {
  await logInAsAdmin(page);
  const category = await createCategory();
  const article = await createArticle({ categoryId: category.id });

  await page.goto(`/admin/content/${article.id}`);
  await page.getByRole("button", { name: Editor.unpublish }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(Editor.unpublishedDone);
  await expect(
    page.getByLabel(Editor.slug, { exact: true }).filter({ visible: true }),
  ).toHaveAttribute("readonly", "");

  await page.getByRole("button", { name: Editor.delete }).click();
  await page.getByRole("button", { name: Editor.deleteYes }).click();
  await expect(page).toHaveURL("/admin/content");
  const { data } = await admin.from("articles").select("id").eq("id", article.id);
  expect(data).toEqual([]);
});

test("a taken slug and a missing body are explained", async ({ page }) => {
  await logInAsAdmin(page);
  const category = await createCategory();
  const other = await createArticle({ categoryId: category.id });

  await page.goto("/admin/content/new");
  await page.getByLabel(Editor.title, { exact: true }).fill("عنوان مقال جديد");
  await page.getByLabel(Editor.slug, { exact: true }).fill(other.slug);
  await page.getByLabel(Editor.category).selectOption({ label: category.name });
  await page.getByRole("button", { name: Editor.publish }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(Editor.bodyRequired);

  await page.getByRole("tabpanel").getByRole("textbox").fill("نص");
  await page.getByRole("button", { name: Editor.publish }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(editErrors.slug_taken);
});

test("an admin adds, renames and reorders categories, and can't delete one in use", async ({
  page,
}) => {
  await logInAsAdmin(page);
  const used = await createCategory();
  await createArticle({ categoryId: used.id, status: "draft" });
  const name = `قسم ${randomBytes(3).toString("hex")}`;

  await page.goto("/admin/content");
  await page.getByRole("link", { name: Content.categories }).click();
  await expect(page.getByRole("heading", { level: 1, name: Categories.title })).toBeVisible();

  await page.getByRole("button", { name: Categories.add }).click();
  const form = page.getByRole("form", { name: Categories.addTitle });
  await form.getByLabel(Categories.name).fill(name);
  await form.getByText(Content.icons.sun).click();
  await form.getByRole("button", { name: Categories.create }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(Categories.created);
  await expect(categoryRow(page, name)).toBeVisible();

  // Rename.
  await page.getByRole("button", { name: fill(Categories.editLabel, { name }) }).click();
  const renamed = `${name} جديد`;
  const edit = page.getByRole("form", { name: fill(Categories.editLabel, { name }) });
  await edit.getByLabel(Categories.name).fill(renamed);
  await edit.getByRole("button", { name: Categories.save }).click();
  await expect(categoryRow(page, renamed)).toBeVisible();

  // Moving it up puts it before the row that was above it.
  const names = async () =>
    (await page.getByRole("rowheader").allTextContents()).map((text) => text.trim());
  const before = await names();
  const index = before.indexOf(renamed);
  await page.getByRole("button", { name: fill(Categories.moveUp, { name: renamed }) }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(Categories.reordered);
  await expect.poll(async () => (await names()).indexOf(renamed)).toBe(index - 1);

  // A category with a draft in it stays.
  await page
    .getByRole("button", { name: fill(Categories.deleteLabel, { name: used.name }) })
    .click();
  await page.getByRole("button", { name: Categories.deleteYes }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(editErrors.category_in_use);

  // An unused one goes.
  await page.getByRole("button", { name: fill(Categories.deleteLabel, { name: renamed }) }).click();
  await page.getByRole("button", { name: Categories.deleteYes }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(Categories.deleted);
  await expect(categoryRow(page, renamed)).toHaveCount(0);
});
