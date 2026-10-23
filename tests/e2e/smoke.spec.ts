import { expect, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

test("/ opens Welcome, in Arabic, right-to-left, in Cairo", async ({ page }) => {
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
