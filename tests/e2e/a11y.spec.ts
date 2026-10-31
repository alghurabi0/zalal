import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { expectNoAxeViolations, focusWithoutIndicator, smallTargets } from "./helpers/a11y";
import { createCrew, createCustomer, logInAsAdmin, logInAsCrew } from "./helpers/admin";
import { createArticle, createCategory } from "./helpers/articles";
import { signUp } from "./helpers/auth";
import { baghdadDate, createCertificate, createOrder, createSlot } from "./helpers/booking";
import { createPartner } from "./helpers/partners";
import { createWorker } from "./helpers/payroll";
import { createStockItem } from "./helpers/stock";

// Accessibility across every surface (Phase 6, task 4): axe (WCAG 2.2 A/AA
// and best practices) on each route, touch targets of at least 44 px (24 px
// for admin text links), names on the controls inside sheets, and a visible
// focus while tabbing. Each role makes its own data.

const { Booking, Home, Order, Settings } = messages;

test.describe.configure({ timeout: 240_000 });

/** Waits for the page to settle, then runs axe and the touch-target check. */
async function audit(page: Page, url: string, { linkMin = 44 } = {}) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main").filter({ visible: true }).first()).toBeVisible();
  // Sticky bottom bars (the tab bar, screen footers) cover whatever sits at
  // the fold until the page scrolls, which axe's target-size counts as
  // obscured. At the end of the page they sit in their own place.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expectNoAxeViolations(page, url);
  expect(await smallTargets(page, { linkMin }), `touch targets on ${url}`).toEqual([]);
}

test("guest screens", async ({ page }) => {
  const category = await createCategory();
  const article = await createArticle({ categoryId: category.id });
  for (const url of [
    "/welcome",
    "/",
    "/login",
    "/tips",
    `/tips/${article.slug}`,
    "/terms",
    "/privacy",
    "/subscription",
    "/no-such-page",
    "/~offline",
  ]) {
    await audit(page, url);
  }
});

test("customer screens, sheets and focus", async ({ page }) => {
  const phone = await signUp(page);
  const slot = await createSlot();
  const crew = await createCrew();
  const date = baghdadDate(1);
  const pending = await createOrder(phone, { slot, date });
  const postponed = await createOrder(phone, { slot, date, status: "postponed" });
  const onTheWay = await createOrder(phone, { slot, date, status: "on_the_way", crewId: crew.id });
  const working = await createOrder(phone, { slot, date, status: "in_progress", crewId: crew.id });
  const done = await createOrder(phone, {
    slot,
    date: baghdadDate(0),
    status: "completed",
    crewId: crew.id,
  });
  const certificate = await createCertificate(done.id);

  for (const url of [
    "/",
    "/orders",
    "/orders?tab=past",
    `/orders/${pending.id}`,
    `/orders/${postponed.id}`,
    `/orders/${onTheWay.id}/track`,
    `/orders/${working.id}/live`,
    `/orders/${done.id}/certificate`,
    `/c/${certificate.public_code}`,
    "/book",
    `/book/done/${pending.id}`,
    "/chat",
    "/issue",
    "/notifications",
    "/profile",
    "/profile/edit",
    "/profile/phone",
    "/profile/certificates",
    "/profile/settings",
    "/reports",
    "/tanks",
    "/addresses/new",
    "/subscription",
  ]) {
    await audit(page, url);
  }

  // Sheets: every control inside has a name, and targets stay 44 px.
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(Home.changeAddress) }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoAxeViolations(page, "Home's address sheet", '[role="dialog"]');
  await page.keyboard.press("Escape");

  await page.goto(`/orders/${pending.id}`);
  await page
    .locator("main")
    .filter({ visible: true })
    .getByRole("button", { name: Order.cancel })
    .click();
  await expect(page.getByRole("dialog", { name: Order.cancelSheet.title })).toBeVisible();
  await expectNoAxeViolations(page, "N6 cancel sheet", '[role="dialog"]');
  expect(await smallTargets(page)).toEqual([]);
  await page.keyboard.press("Escape");

  // N7 and its postpone step.
  await page.goto(`/orders/${pending.id}`);
  await page
    .locator("main")
    .filter({ visible: true })
    .getByRole("button", { name: Order.reschedule })
    .click();
  const reschedule = page.getByRole("dialog", { name: Order.rescheduleSheet.title });
  await expect(reschedule).toBeVisible();
  await expectNoAxeViolations(page, "N7 reschedule sheet", '[role="dialog"]');
  expect(await smallTargets(page)).toEqual([]);
  // "تاريخ آخر" opens the month calendar under the days.
  await reschedule.getByRole("button", { name: Booking.calendar.open }).click();
  await expect(reschedule.getByRole("table")).toBeVisible();
  await expectNoAxeViolations(page, "N7 month calendar", '[role="dialog"]');
  expect(await smallTargets(page)).toEqual([]);
  await reschedule.getByRole("button", { name: Order.rescheduleSheet.postpone }).click();
  await expect(page.getByRole("dialog", { name: Order.postponeSheet.title })).toBeVisible();
  await expectNoAxeViolations(page, "N7 postpone step", '[role="dialog"]');
  expect(await smallTargets(page)).toEqual([]);
  await page.keyboard.press("Escape");

  await page.goto("/profile/settings");
  await page.getByRole("button", { name: Settings.deleteAccount }).click();
  await expect(page.getByRole("dialog", { name: Settings.deleteTitle })).toBeVisible();
  await expectNoAxeViolations(page, "N13 delete sheet", '[role="dialog"]');
  await page.keyboard.press("Escape");

  // Focus is visible on every stop while tabbing.
  for (const url of ["/", "/orders", "/profile"]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    expect(await focusWithoutIndicator(page, 15), `focus on ${url}`).toEqual([]);
  }
});

test("crew screens", async ({ page }) => {
  const customer = await createCustomer();
  const slot = await createSlot();
  const crew = await logInAsCrew(page);
  const job = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(0),
    status: "confirmed",
    crewId: crew.id,
  });
  for (const url of ["/crew", `/crew/jobs/${job.id}`]) await audit(page, url);
  await page.goto("/crew");
  await page.waitForLoadState("networkidle");
  expect(await focusWithoutIndicator(page, 10), "focus on C2").toEqual([]);
});

test.describe("admin", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("admin screens", async ({ page }) => {
    const customer = await createCustomer();
    const slot = await createSlot();
    const order = await createOrder(customer.phone, { slot, date: baghdadDate(1) });
    const category = await createCategory();
    const article = await createArticle({ categoryId: category.id, status: "draft" });
    const crew = await createCrew();
    const { id: adminId } = await logInAsAdmin(page);
    const worker = await createWorker({ createdBy: adminId, crewId: crew.id });
    const partner = await createPartner();
    const stockItem = await createStockItem();
    for (const url of [
      "/admin",
      `/admin?period=${baghdadDate(0).slice(0, 7)}`,
      "/admin/orders",
      `/admin/orders?status=all&from=${baghdadDate(0)}`,
      `/admin/orders?order=${order.id}`,
      "/admin/orders/board",
      "/admin/live",
      "/admin/chat",
      "/admin/tickets",
      "/admin/customers",
      `/admin/customers?customer=${customer.id}`,
      "/admin/ratings",
      "/admin/prices",
      "/admin/schedule",
      "/admin/subscriptions",
      "/admin/content",
      "/admin/content/new",
      `/admin/content/${article.id}`,
      "/admin/content/categories",
      "/admin/crews",
      "/admin/admins",
      "/admin/audit",
      "/admin/settings",
      "/admin/settings/area",
      "/admin/finance",
      "/admin/finance?transfer=new",
      "/admin/finance/expenses",
      "/admin/finance/expenses?expense=new",
      "/admin/finance/settings",
      "/admin/finance/revenue",
      "/admin/finance/revenue?sale=new",
      "/admin/finance/overview",
      "/admin/finance/reports",
      "/admin/finance/reports?year=2026",
      "/admin/finance/payroll",
      "/admin/finance/payroll?worker=new",
      `/admin/finance/payroll?worker=${worker.id}`,
      `/admin/finance/expenses?expense=new&worker=${worker.id}`,
      "/admin/finance/partners",
      "/admin/finance/partners?partner=new",
      `/admin/finance/partners?partner=${partner.id}`,
      "/admin/finance/partners?shares=1",
      "/admin/finance/partners?equipment=new",
      "/admin/finance/stock",
      "/admin/finance/stock?item=new",
      `/admin/finance/stock?item=${stockItem.id}`,
      "/admin/finance/stock?move=new&kind=in",
      `/admin/finance/stock?move=new&kind=out&of=${stockItem.id}`,
      "/admin/finance/stock?move=new&kind=count",
    ]) {
      await audit(page, url, { linkMin: 24 });
    }
  });
});
