import { expect, test } from "@playwright/test";

test("root renders Arabic, right-to-left, in Cairo", async ({ page }) => {
  await page.goto("/");

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
