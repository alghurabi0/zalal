import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium, expect, type Page, test } from "@playwright/test";

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

  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0a2a5e");
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

  // Welcome showed on the first visit, so "/" is now guest Home (spec §5.1).
  await expect(page.getByRole("heading", { name: messages.Home.headline })).toBeVisible();
});

// Lighthouse 12+ has no PWA category, so "Lighthouse PWA ≥ 90" (spec §12.3)
// is this check instead (Phase 6, task 4): Chrome's own installability test
// and manifest parser. It needs a profile on disk, since Chrome never offers
// to install from an incognito one (Playwright's usual context).
test("Chrome finds the app installable, with a valid manifest", async ({ baseURL }) => {
  const dir = await mkdtemp(path.join(tmpdir(), "zalal-pwa-"));
  const context = await chromium.launchPersistentContext(dir, {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    baseURL,
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("/welcome");
    await waitForServiceWorker(page);
    await page.reload();

    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
    expect(installabilityErrors).toEqual([]);
    const manifest = await cdp.send("Page.getAppManifest");
    expect(manifest.errors).toEqual([]);

    const parsed = JSON.parse(manifest.data ?? "{}") as Record<string, unknown>;
    expect(parsed).toMatchObject({ display: "standalone", start_url: "/", theme_color: "#0a2a5e" });
    const icons = parsed.icons as { sizes: string; purpose?: string }[];
    expect(icons.map((icon) => `${icon.sizes} ${icon.purpose ?? "any"}`)).toEqual(
      expect.arrayContaining(["192x192 any", "512x512 any", "512x512 maskable"]),
    );
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      /viewport-fit=cover/,
    );
  } finally {
    await context.close();
    await rm(dir, { recursive: true, force: true });
  }
});
