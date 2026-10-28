import { expect, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { logInAsAdmin } from "./helpers/admin";

// Screen states every surface shares (spec §5 global rules; Phase 6, task 4).
// The offline error state is a unit test (error-screens.test.tsx): a failed
// navigation without network gets the service worker's offline page here.

const { NotFound } = messages;

test("an unknown URL shows the Arabic 404 with a way Home", async ({ page }) => {
  // Login-only prefixes (/orders, /crew…) send a guest to Login first.
  for (const url of ["/no-such-page", "/tips/a/b"]) {
    const response = await page.goto(url);
    expect(response?.status(), url).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: NotFound.title })).toBeVisible();
  }
  await page.getByRole("link", { name: NotFound.home }).click();
  await expect(page).toHaveURL(/\/(welcome)?$/);
});

test.describe("admin", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("an unknown dashboard URL shows the 404, and Home leads back to the dashboard", async ({
    page,
  }) => {
    await logInAsAdmin(page);
    await page.goto("/admin/no-such-page");
    await expect(page.getByRole("heading", { level: 1, name: NotFound.title })).toBeVisible();
    await page.getByRole("link", { name: NotFound.home }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });
});
