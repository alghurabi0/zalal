import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

/** Waits until the service worker from `pnpm build` controls the page. */
async function waitForServiceWorker(page: Page) {
  const scriptURL = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.scriptURL;
  });
  expect(scriptURL).toMatch(/\/sw\.js$/);
  // clientsClaim makes the new worker take over the open page.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test("links the manifest, icons and theme color", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0b2545");
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
    "content",
    "yes",
  );

  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect((await request.get(appleIcon ?? "")).headers()["content-type"]).toBe("image/png");

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await request.get(manifestHref ?? "")).json();
  expect(manifest).toMatchObject({ name: messages.Metadata.title, dir: "rtl", lang: "ar" });

  for (const icon of manifest.icons as { src: string }[]) {
    const response = await request.get(icon.src);
    expect(response.ok(), icon.src).toBe(true);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
});

test("shows the offline page when a page can't load, and retries", async ({ page, context }) => {
  await page.goto("/");
  await waitForServiceWorker(page);

  await context.setOffline(true);
  await page.goto("/");

  // The worker never caches pages, so "/" falls back to the offline page.
  await expect(page.getByRole("heading", { name: messages.Offline.title })).toBeVisible();
  await expect(page).toHaveURL("/");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "test-results/screenshots/offline.png" });

  await context.setOffline(false);
  await page.getByRole("link", { name: messages.Offline.retry }).click();

  await expect(page.getByRole("heading", { name: messages.Welcome.name })).toBeVisible();
});
