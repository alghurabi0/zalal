import { expect, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

test("/ opens Welcome on first open, in Arabic, right-to-left, in Cairo", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/welcome");

  const html = page.locator("html");
  await expect(html).toHaveAttribute("lang", "ar");
  await expect(html).toHaveAttribute("dir", "rtl");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(fontFamily).toMatch(/Cairo/);

  // Wait for Cairo to load so the screenshot shows the real font.
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "test-results/screenshots/root.png" });
});

test("after Welcome, / opens Home in guest mode, with سجّل دخول", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/welcome");
  await page.getByRole("link", { name: messages.Welcome.browse }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(messages.Home.headline);
  const login = page.getByRole("link", { name: messages.Home.login });
  await expect(login).toHaveAttribute("href", "/login");
  const box = await login.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("navigation", { name: messages.UI.tabs.label })).toBeVisible();

  // A reload stays on Home: Welcome shows on first open only.
  await page.reload();
  await expect(page).toHaveURL("/");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "test-results/screenshots/home-guest.png" });
});

test("a guest opening a page that needs a login goes to Login and back", async ({ page }) => {
  await page.goto("/tanks");
  await expect(page).toHaveURL("/login?next=%2Ftanks");
});

test("Welcome links to Login and to guest browsing", async ({ page }) => {
  await page.goto("/welcome");

  await expect(page.getByRole("link", { name: messages.Welcome.start })).toHaveAttribute(
    "href",
    "/login",
  );
  await expect(page.getByRole("link", { name: messages.Welcome.browse })).toHaveAttribute(
    "href",
    "/",
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "test-results/screenshots/welcome.png" });
});
