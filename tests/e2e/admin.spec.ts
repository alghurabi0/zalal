import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCrew, createCustomer, logInAsAdmin } from "./helpers/admin";
import { enterCode, requestCode, screenshot } from "./helpers/auth";
import {
  baghdadDate,
  createOrder,
  createSlot,
  disableSlot,
  pickSlot,
  type TestSlot,
} from "./helpers/booking";
import { admin } from "./helpers/supabase";

// Admin dashboard, part A (spec §8.2): the shell, Overview (A1), Orders (A2)
// with the drawer's actions, and the date × slot board. Admin is
// desktop-first, so these run at a desktop size.

const { Admin, Orders } = messages;
const { actions: Actions, drawer: Drawer } = Admin;

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

let slot: TestSlot | null = null;
test.afterEach(async () => {
  if (slot) await disableSlot(slot.id);
  slot = null;
});

/** Opens the order's drawer from the list filtered to the test's slot. */
async function openOrder(page: Page, testSlot: TestSlot, number: number) {
  await page.goto(`/admin/orders?status=all&slot=${testSlot.id}`);
  await page
    .getByRole("link", { name: Admin.table.open.replace("{number}", String(number)) })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { level: 2 }).first()).toBeVisible();
  return dialog;
}

/** The drawer's title holds the status badge, so its name says the status. */
async function expectStatus(page: Page, status: keyof typeof Orders.status) {
  await expect(page.getByRole("dialog", { name: new RegExp(Orders.status[status]) })).toBeVisible();
}

async function orderRow(id: string) {
  const { data } = await admin
    .from("orders")
    .select("status, crew_id, service_date, slot_id")
    .eq("id", id)
    .single()
    .throwOnError();
  return data;
}

async function auditActions(id: string) {
  const { data } = await admin
    .from("admin_audit_log")
    .select("action")
    .eq("entity_id", id)
    .order("id")
    .throwOnError();
  return data.map((row) => row.action);
}

test("customers are sent away from the admin dashboard", async ({ page }) => {
  const customer = await createCustomer();
  await requestCode(page, customer.phone);
  await enterCode(page, customer.phone);
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto("/admin/orders");
  await expect(page).toHaveURL("/");
});

test("an admin confirms an order with a crew, and both are audited", async ({ page }) => {
  slot = await createSlot();
  const customer = await createCustomer("زينب حسن");
  const crew = await createCrew();
  const order = await createOrder(customer.phone, { slot, date: baghdadDate(2) });
  await logInAsAdmin(page);

  const dialog = await openOrder(page, slot, order.number);
  await expect(dialog).toContainText("زينب حسن");
  await expect(dialog).toContainText(customer.district);
  await expectStatus(page, "pending_confirmation");
  await screenshot(page, "admin-drawer");

  await dialog.getByRole("button", { name: Actions.modes.confirm, exact: true }).click();
  await dialog.getByLabel(Actions.confirmCrew).selectOption(crew.id);
  await dialog.getByRole("button", { name: Actions.confirm }).click();
  await expect(dialog.getByRole("status")).toContainText(Actions.saved);
  await expectStatus(page, "confirmed");
  await expect(dialog).toContainText(crew.name);

  expect(await orderRow(order.id)).toMatchObject({ status: "confirmed", crew_id: crew.id });
  expect(await auditActions(order.id)).toEqual(["order.transition", "order.assign_crew"]);

  // Closing the drawer keeps the list's filters.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(`/admin/orders?status=all&slot=${slot.id}`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("cancelling needs a reason, which stays an internal note", async ({ page }) => {
  slot = await createSlot();
  const customer = await createCustomer();
  const order = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(1),
    status: "confirmed",
  });
  await logInAsAdmin(page);

  const dialog = await openOrder(page, slot, order.number);
  await dialog.getByRole("button", { name: Actions.modes.cancel, exact: true }).click();
  const submit = dialog.getByRole("button", { name: Actions.cancel });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(Actions.cancelReason).fill("الزبون اتصل وطلب الإلغاء");
  await submit.click();
  await expectStatus(page, "cancelled");
  await expect(dialog).toContainText("الزبون اتصل وطلب الإلغاء");

  expect((await orderRow(order.id)).status).toBe("cancelled");
  const { count } = await admin
    .from("slot_bookings")
    .select("*", { count: "exact", head: true })
    .eq("order_id", order.id);
  expect(count).toBe(0);
});

test("rescheduling keeps the crew and sends the order back to pending", async ({ page }) => {
  slot = await createSlot();
  const customer = await createCustomer();
  const crew = await createCrew();
  const order = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(1),
    status: "confirmed",
  });
  await admin.from("orders").update({ crew_id: crew.id }).eq("id", order.id).throwOnError();
  await logInAsAdmin(page);

  const dialog = await openOrder(page, slot, order.number);
  await dialog.getByRole("button", { name: Actions.modes.reschedule, exact: true }).click();
  const newDate = baghdadDate(3);
  await pickSlot(page, newDate, slot.label);
  await dialog.getByRole("button", { name: Actions.reschedule }).click();
  await expect(dialog.getByRole("status")).toContainText(Actions.saved);
  await expectStatus(page, "pending_confirmation");

  expect(await orderRow(order.id)).toMatchObject({
    status: "pending_confirmation",
    service_date: newDate,
    crew_id: crew.id,
  });
});

test("an override needs a reason and is marked in the timeline", async ({ page }) => {
  slot = await createSlot();
  const customer = await createCustomer();
  const order = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(2),
    status: "cancelled",
  });
  await logInAsAdmin(page);

  const dialog = await openOrder(page, slot, order.number);
  await dialog.getByRole("button", { name: Actions.modes.override, exact: true }).click();
  await dialog.getByLabel(Actions.overrideTo).selectOption("confirmed");
  const submit = dialog.getByRole("button", { name: Actions.override });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(Actions.overrideReason).fill("انلغى بالغلط");
  await submit.click();
  await expectStatus(page, "confirmed");
  await expect(dialog.getByText(Drawer.override, { exact: true })).toBeVisible();
  await expect(dialog).toContainText("انلغى بالغلط");

  expect((await orderRow(order.id)).status).toBe("confirmed");
  // Back out of cancelled, it holds a place again.
  const { count } = await admin
    .from("slot_bookings")
    .select("*", { count: "exact", head: true })
    .eq("order_id", order.id);
  expect(count).toBe(1);
});

test("filters narrow the list and survive in the URL", async ({ page }) => {
  slot = await createSlot();
  const first = await createCustomer();
  const second = await createCustomer();
  const a = await createOrder(first.phone, { slot, date: baghdadDate(2) });
  const b = await createOrder(second.phone, { slot, date: baghdadDate(2) });
  await logInAsAdmin(page);

  await page.goto(`/admin/orders?slot=${slot.id}`);
  const table = page.getByRole("table", { name: Admin.orders.caption });
  await expect(table.getByRole("row")).toHaveCount(3);
  await page.getByLabel(Admin.orders.district).fill(first.district);
  await page.getByRole("button", { name: Admin.orders.apply }).click();
  await expect(page).toHaveURL(/district=/);
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText(`#${a.number}`);
  await expect(table).not.toContainText(`#${b.number}`);

  await page.getByLabel(Admin.orders.status).selectOption("cancelled");
  await page.getByRole("button", { name: Admin.orders.apply }).click();
  await expect(page.getByRole("heading", { name: Admin.orders.emptyFiltered })).toBeVisible();
  await screenshot(page, "admin-orders-empty");
});

test("the board shows places taken and opens a slot's orders", async ({ page }) => {
  slot = await createSlot(2);
  const customer = await createCustomer();
  const date = baghdadDate(1);
  const order = await createOrder(customer.phone, { slot, date });
  await logInAsAdmin(page);

  await page.goto("/admin/orders/board");
  const link = page.locator(`a[href*="slot=${slot.id}"][href*="date=${date}"]`);
  await expect(link).toHaveText(/1\/2/);
  await expect(link).toHaveAttribute("aria-label", /1 من 2/);
  await screenshot(page, "admin-board");
  await link.click();
  await expect(page).toHaveURL(new RegExp(`date=${date}.*slot=${slot.id}`));
  await expect(page.getByRole("table", { name: Admin.orders.caption })).toContainText(
    `#${order.number}`,
  );
});

test("Overview updates live and links a new booking", async ({ page }) => {
  slot = await createSlot();
  const customer = await createCustomer();
  await logInAsAdmin(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(Admin.overview.title);

  const sound = page.getByRole("button", { name: Admin.live.soundOff });
  await sound.click();
  await expect(page.getByRole("button", { name: Admin.live.soundOn })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await screenshot(page, "admin-overview");

  // Give Realtime a moment to join before the booking arrives.
  await page.waitForTimeout(1500);
  const order = await createOrder(customer.phone, { slot, date: baghdadDate(0) });
  const alert = page.getByRole("link", { name: new RegExp(`#${order.number}`) }).first();
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await alert.click();
  await expect(page).toHaveURL(`/admin/orders?order=${order.id}`);
  await expectStatus(page, "pending_confirmation");
});

test.describe("on a tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("the shell and the list fit", async ({ page }) => {
    await logInAsAdmin(page);
    await page.getByRole("link", { name: Admin.nav.orders }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(Admin.orders.title);
    await expect(page.getByRole("link", { name: Admin.nav.orders })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("button", { name: Admin.orders.apply })).toBeVisible();
    // No sideways page scroll; wide tables scroll inside their box.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      820,
    );
    await screenshot(page, "admin-orders-tablet");
  });
});
