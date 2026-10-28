import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createArticle, createCategory } from "./helpers/articles";
import { screenshot } from "./helpers/auth";

// Tips (spec §5.6, Tips.dc.html), Article (N9) and Home's tips strip
// (§5.5), as a guest. The local seed publishes the six §10.2 articles, with
// "5 علامات تكول خزانك يحتاج تنظيف" the newest featured one.

const { Tips, Article, Home, UI } = messages;
const TOP = "5 علامات تكول خزانك يحتاج تنظيف";

const welcomed = (context: BrowserContext) =>
  context.addCookies([{ name: "zl_welcomed", value: "1", url: "http://localhost:3100" }]);

async function expectTarget(page: Page, locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
}

test("a guest browses Tips, filters by category and opens an article", async ({
  page,
  context,
}) => {
  await welcomed(context);
  await page.goto("/tips");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: Tips.title })).toBeVisible();
  await expect(page).toHaveTitle(Tips.metaTitle);

  // Chips: الكل first, then the seeded categories in their order.
  const chips = page.getByRole("group", { name: Tips.categories });
  const radios = chips.getByRole("radio");
  await expect(radios.first()).toBeChecked();
  for (const name of [Tips.all, "صحة", "نصائح", "الصيف"]) {
    await expect(chips.getByText(name, { exact: true })).toBeVisible();
  }

  // The top card: the newest featured article with its five signs.
  const top = page.getByRole("link", { name: new RegExp(TOP) });
  await expect(top).toContainText(Tips.featured);
  await expect(top.getByRole("listitem")).toHaveCount(5);
  await expect(top.getByRole("listitem").first()).toHaveText(/ريحة غريبة/);

  // Every other article is a card; the back button and cards are 44px+.
  const list = page.getByRole("main");
  await expect(list.getByRole("link", { name: /ليش لازم تنظف الخزان/ })).toBeVisible();
  await expectTarget(page, page.getByRole("link", { name: UI.back }));
  await expectTarget(page, list.getByRole("link", { name: /ليش لازم تنظف الخزان/ }));
  await screenshot(page, "tips");

  // صحة: the top card (نصائح) goes, only health articles stay.
  await chips.getByText("صحة", { exact: true }).click();
  await expect(top).toBeHidden();
  await expect(list.getByRole("link", { name: /ريحة الكلور/ })).toBeVisible();
  await expect(list.getByRole("link", { name: /غطاء الخزان/ })).toBeHidden();
  // Chips are 38px tall as in the canvas; the kit's ::after strip makes the target 44px.

  // Back to الكل, then open an article.
  await chips.getByText(Tips.all, { exact: true }).click();
  await top.click();
  await expect(page).toHaveURL("/tips/tank-cleaning-signs");
  await expect(page.getByRole("heading", { level: 1, name: TOP })).toBeVisible();
  await expect(page).toHaveTitle(TOP);
  await expect(page.getByRole("heading", { level: 2, name: "العلامات الخمس" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: UI.tabs.label })).toHaveCount(0);
  await screenshot(page, "article");

  // احجز تنظيف goes through login for a guest.
  await page.getByRole("link", { name: Article.book }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fbook/);
});

test("Tips and Article show published articles only", async ({ page, context }) => {
  await welcomed(context);
  const category = await createCategory();
  const draft = await createArticle({ categoryId: category.id, status: "draft" });
  const published = await createArticle({ categoryId: category.id });

  await page.goto("/tips");
  const chips = page.getByRole("group", { name: Tips.categories });
  // A category shows once it has a published article.
  await chips.getByText(category.name, { exact: true }).click();
  await expect(page.getByRole("link", { name: new RegExp(published.title) })).toBeVisible();
  await expect(page.getByText(draft.title)).toHaveCount(0);

  await page.goto(`/tips/${draft.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: Article.notFoundTitle })).toBeVisible();
  await page.getByRole("link", { name: Article.notFoundAction }).click();
  await expect(page).toHaveURL("/tips");

  await page.goto(`/tips/${published.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: published.title })).toBeVisible();
  await expect(page.locator("article strong")).toHaveText("للتجربة");
});

test("Home shows the tips strip to guests, opening Tips and the articles", async ({
  page,
  context,
}) => {
  await welcomed(context);
  await page.goto("/");
  const strip = page.getByRole("region", { name: Home.tips.title });
  await expect(strip.getByRole("listitem")).toHaveCount(2);
  await expect(strip.getByRole("link", { name: new RegExp(TOP) })).toBeVisible();
  await expectTarget(page, strip.getByRole("link", { name: Home.tips.seeAll }));

  await strip.getByRole("link", { name: Home.tips.seeAll }).click();
  await expect(page).toHaveURL("/tips");
  await page.getByRole("link", { name: UI.back }).click();
  await expect(page).toHaveURL("/");
  await page
    .getByRole("region", { name: Home.tips.title })
    .getByRole("link", { name: /ليش لازم تنظف الخزان/ })
    .click();
  await expect(page).toHaveURL("/tips/clean-every-six-months");
});
