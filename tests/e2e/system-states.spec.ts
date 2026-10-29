import { expect, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { expectNoAxeViolations, smallTargets } from "./helpers/a11y";
import { createCustomer, logInAsAdmin } from "./helpers/admin";
import { enterCode, requestCode, screenshot, signUp } from "./helpers/auth";
import {
  baghdadDate,
  createCertificate,
  createOrder,
  createSlot,
  disableSlot,
} from "./helpers/booking";
import { admin } from "./helpers/supabase";

// N16 maintenance mode and A13's "التطبيق" section (Phase 6, task 3). The
// switch is global, so this file runs in its own project after every other
// test (playwright.config.ts) and one test at a time. The server reads the
// switch at most every 10 s, hence the long polls. The company phones and
// the certificate stamp (A13) are global too, so their tests live here.

const { System, Admin, Chat, UI, CertificateDoc } = messages;
const A13 = Admin.settings;

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await admin
    .from("settings")
    .update({
      maintenance_mode: false,
      min_app_version: "0.0.0",
      company_phone_2: null,
      certificate_stamp_path: null,
    })
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
  // Each server instance keeps the switch up to 10 s (src/proxy.ts), so one
  // may still say "on" after the guest's reload saw "off": wait it out, or
  // the next test's customer lands on the maintenance screen.
  await page.waitForTimeout(11_000);
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

test("A13 saves a second phone; Chat's call button offers both numbers", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await logInAsAdmin(page);
  await page.goto("/admin/settings");
  const section = page.getByRole("form", { name: A13.support.title });
  await section.getByLabel(A13.support.phone, { exact: true }).fill("07764349984");
  await section.getByLabel(A13.support.phone2).fill("0776 434 9984");
  await expect(section.getByText(A13.support.samePhone)).toBeVisible();
  await expect(section.getByRole("button", { name: A13.save })).toBeDisabled();
  await section.getByLabel(A13.support.phone2).fill("07867903703");
  await section.getByRole("button", { name: A13.save }).click();
  await expect(section.getByText(A13.saved)).toBeVisible();
  const { data } = await admin
    .from("settings")
    .select("company_phone, company_phone_2")
    .single()
    .throwOnError();
  expect(data).toEqual({ company_phone: "+9647764349984", company_phone_2: "+9647867903703" });

  const customer = await browser.newContext({ ...test.info().project.use });
  const customerPage = await customer.newPage();
  await signUp(customerPage);
  await customerPage.goto("/chat");
  await customerPage.getByRole("button", { name: Chat.call }).click();
  const sheet = customerPage.getByRole("dialog", { name: UI.callCompany });
  await expect(sheet.getByRole("link")).toHaveCount(2);
  await expect(sheet.getByRole("link").first()).toHaveAttribute("href", "tel:+9647764349984");
  await expect(sheet.getByRole("link").last()).toHaveAttribute("href", "tel:+9647867903703");
  await screenshot(customerPage, "call-company");
  await expectNoAxeViolations(customerPage, "Chat's call sheet", '[role="dialog"]');
  expect(await smallTargets(customerPage)).toEqual([]);
  await customer.close();

  await page.goto("/admin/settings");
  await section.getByLabel(A13.support.phone2).fill("");
  await section.getByRole("button", { name: A13.save }).click();
  await expect(section.getByText(A13.saved)).toBeVisible();
});

test("A13 uploads the certificate stamp, the certificate prints it, and removing it frees the file", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await logInAsAdmin(page);
  await page.goto("/admin/settings");
  const card = page.getByRole("region", { name: A13.stamp.title });
  await expect(card.getByText(A13.stamp.empty)).toBeVisible();
  await card.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/tank.jpg");
  await expect(card.getByText(A13.stamp.saved)).toBeVisible();
  await expect(card.getByRole("img", { name: A13.stamp.preview })).toBeVisible();
  await card.screenshot({ path: "test-results/screenshots/a13-stamp.png" });
  const { data } = await admin
    .from("settings")
    .select("certificate_stamp_path")
    .single()
    .throwOnError();
  const path = data.certificate_stamp_path;
  expect(path).toMatch(/^stamp\/[0-9a-f-]+\.webp$/);

  // The certificate prints it in place of the dashed box.
  const slot = await createSlot();
  try {
    const customer = await createCustomer("زبونة الختم");
    const order = await createOrder(customer.phone, {
      slot,
      date: baghdadDate(0),
      status: "completed",
    });
    const certificate = await createCertificate(order.id);
    const customerContext = await browser.newContext({ ...test.info().project.use });
    const customerPage = await customerContext.newPage();
    await requestCode(customerPage, customer.phone);
    await enterCode(customerPage, customer.phone);
    await customerPage.waitForURL((url) => !url.pathname.startsWith("/login"));
    await customerPage.goto(`/certificates/${certificate.id}/print`);
    const stamp = customerPage
      .locator("[data-certificate]")
      .getByRole("img", { name: CertificateDoc.stamp });
    await expect(stamp).toHaveAttribute("src", new RegExp(`${path}$`));
    await expect
      .poll(() => stamp.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await customerContext.close();
  } finally {
    await disableSlot(slot.id);
  }

  // Removing it clears the setting and deletes the file.
  await card.getByRole("button", { name: A13.stamp.remove }).click();
  await expect(card.getByText(A13.stamp.removed)).toBeVisible();
  await expect(card.getByText(A13.stamp.empty)).toBeVisible();
  const files = await admin.storage.from("public-content").list("stamp");
  expect(files.data?.map((file) => `stamp/${file.name}`)).not.toContain(path);
});
