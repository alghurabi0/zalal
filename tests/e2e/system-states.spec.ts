import { expect, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { logInAsAdmin } from "./helpers/admin";
import { screenshot } from "./helpers/auth";
import { admin } from "./helpers/supabase";

// N16 maintenance mode and A13's "التطبيق" section (Phase 6, task 3). The
// switch is global, so this file runs in its own project after every other
// test (playwright.config.ts) and one test at a time. The server reads the
// switch at most every 10 s, hence the long polls.

const { System, Admin } = messages;
const A13 = Admin.settings;

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await admin
    .from("settings")
    .update({ maintenance_mode: false, min_app_version: "0.0.0" })
    .eq("id", true)
    .throwOnError();
});

test("maintenance from A13 stops customers and guests, not admins", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await logInAsAdmin(page);
  await page.goto("/admin/settings");
  const section = page.getByRole("form", { name: A13.app.title });
  await section.getByLabel(A13.app.maintenance).check();
  await section.getByRole("button", { name: A13.save }).click();
  await expect(section.getByText(A13.saved)).toBeVisible();

  const guest = await browser.newContext({ ...test.info().project.use });
  const guestPage = await guest.newPage();
  await expect(async () => {
    await guestPage.goto("/tips");
    await expect(guestPage.getByRole("heading", { name: System.maintenanceTitle })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  // The customer keeps the URL, so a reload after maintenance lands there.
  await expect(guestPage).toHaveURL("/tips");
  await screenshot(guestPage, "maintenance");

  // Staff keep working.
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: System.maintenanceTitle })).toHaveCount(0);

  await page.goto("/admin/settings");
  await section.getByLabel(A13.app.maintenance).uncheck();
  await section.getByRole("button", { name: A13.save }).click();
  await expect(section.getByText(A13.saved)).toBeVisible();
  await expect(async () => {
    await guestPage.reload();
    await expect(guestPage.getByRole("heading", { name: System.maintenanceTitle })).toHaveCount(0, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  await guest.close();
});

test("A13 refuses a minimum version that isn't x.y.z or is above this build", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await logInAsAdmin(page);
  await page.goto("/admin/settings");
  const section = page.getByRole("form", { name: A13.app.title });
  await section.getByLabel(A13.app.minVersion).fill("1.2");
  await expect(section.getByText(A13.app.minVersionInvalid)).toBeVisible();
  await expect(section.getByRole("button", { name: A13.save })).toBeDisabled();
  // Above this build, it would lock A13 out too.
  await section.getByLabel(A13.app.minVersion).fill("999.0.0");
  await expect(section.getByText(A13.app.minVersionTooNew.split(" (")[0] ?? "")).toBeVisible();
  await expect(section.getByRole("button", { name: A13.save })).toBeDisabled();
});
