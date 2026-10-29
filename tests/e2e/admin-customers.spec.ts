import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCustomer, logInAsAdmin } from "./helpers/admin";
import { e164, screenshot } from "./helpers/auth";
import {
  baghdadDate,
  createOrder,
  createSlot,
  disableSlot,
  type TestSlot,
} from "./helpers/booking";
import { admin } from "./helpers/supabase";

// A6 customers (spec §8.2): every customer account, booked or not, with how
// many orders each made; search by name or phone, sort by sign-up or by
// orders, and a drawer with their orders, addresses and chat.

test.use({ viewport: { width: 1280, height: 800 } });

const { Admin } = messages;
const A6 = Admin.customers;

let slot: TestSlot | null = null;
test.beforeEach(async () => {
  slot = await createSlot();
});
test.afterEach(async () => {
  if (slot) await disableSlot(slot.id);
  slot = null;
});

const main = (page: Page) => page.getByRole("main");
const bodyRows = (page: Page) =>
  main(page)
    .getByRole("row")
    .filter({ hasNot: page.locator("th") });

test("an admin lists customers with their bookings, searches, sorts and opens one", async ({
  page,
}) => {
  // Other tests make customers at the same time, so this one's share a tag.
  const tag = String(Date.now()).slice(-6);
  const booked = await createCustomer(`زبون حاجز ${tag}`);
  const completed = await createOrder(booked.phone, {
    slot: slot!,
    date: baghdadDate(0),
    status: "completed",
  });
  const cancelled = await createOrder(booked.phone, {
    slot: slot!,
    date: baghdadDate(1),
    status: "cancelled",
  });
  const confirmed = await createOrder(booked.phone, {
    slot: slot!,
    date: baghdadDate(2),
    status: "confirmed",
  });
  // Signed up later and never booked.
  await createCustomer(`زبون جديد ${tag}`);
  // Never booked and never entered a name: still listed.
  const nameless = await createCustomer();
  await admin.from("profiles").update({ full_name: null }).eq("id", nameless.id).throwOnError();

  await logInAsAdmin(page);
  await page.getByRole("navigation").getByRole("link", { name: Admin.nav.customers }).click();
  await page.waitForURL("**/admin/customers");

  // By name.
  await main(page).getByLabel(A6.search).fill(`زبون حاجز ${tag}`);
  await main(page).getByRole("button", { name: A6.apply }).click();
  await page.waitForURL(/q=/);
  await expect(bodyRows(page)).toHaveCount(1);
  const bookedRow = bodyRows(page).first();
  await expect(bookedRow).toContainText(booked.district);
  // Every order counts, the cancelled one too.
  await expect(bookedRow.getByRole("cell").nth(2)).toHaveText("3");
  await expect(main(page).getByText("زبون واحد")).toBeVisible();

  // By phone digits as typed (07…): the customer with no name and no orders.
  await main(page).getByLabel(A6.search).fill(nameless.phone);
  await main(page).getByRole("button", { name: A6.apply }).click();
  await expect(bodyRows(page)).toHaveCount(1);
  const namelessRow = bodyRows(page).first();
  await expect(namelessRow).toContainText(A6.noName);
  await expect(namelessRow.getByRole("cell").nth(2)).toHaveText("0");
  await expect(namelessRow.getByRole("cell").nth(3)).toHaveText(A6.none);

  // Both named ones, by the shared tag: newest first, then most orders first.
  await main(page).getByLabel(A6.search).fill(tag);
  await main(page).getByRole("button", { name: A6.apply }).click();
  await page.waitForURL(new RegExp(`q=${tag}`));
  // Phone digits match the tag too, so look only at these two rows.
  const ours = bodyRows(page).filter({ hasText: new RegExp(`زبون (حاجز|جديد) ${tag}`) });
  await expect(ours).toHaveCount(2);
  await expect(ours.first()).toContainText(`زبون جديد ${tag}`);
  await main(page).getByLabel(A6.sort).selectOption("most_orders");
  await main(page).getByRole("button", { name: A6.apply }).click();
  await page.waitForURL(/sort=most_orders/);
  await expect(ours.first()).toContainText(`زبون حاجز ${tag}`);
  await screenshot(page, "admin-customers");

  // The drawer: phone, sign-up, the count, the orders and no chat yet.
  await ours
    .first()
    .getByRole("link", { name: new RegExp(`زبون حاجز ${tag}`) })
    .click();
  await page.waitForURL(/customer=/);
  const drawer = page.getByRole("dialog", { name: `زبون حاجز ${tag}` });
  await expect(drawer.getByRole("link", { name: /\+964/ })).toHaveAttribute(
    "href",
    `tel:${e164(booked.phone)}`,
  );
  await expect(drawer.getByText(A6.drawer.orders).locator("..")).toContainText("3");
  for (const order of [completed, cancelled, confirmed]) {
    await expect(drawer.getByRole("link", { name: new RegExp(`#${order.number}`) })).toBeVisible();
  }
  await expect(drawer).toContainText(booked.district);
  await expect(drawer.getByText(A6.drawer.noThread)).toBeVisible();
  // After the drawer's fade-in, so the list doesn't show through.
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await screenshot(page, "admin-customer-drawer");

  // An order opens in A2.
  await drawer.getByRole("link", { name: new RegExp(`#${confirmed.number}`) }).click();
  await page.waitForURL(`**/admin/orders?order=${confirmed.id}`);
});

test("A6 leaves out crew and admin accounts", async ({ page }) => {
  const { phone } = await logInAsAdmin(page, "مشرف الزبائن");
  await page.goto(`/admin/customers?q=${encodeURIComponent(phone.slice(-8))}`);
  await expect(main(page).getByText(A6.emptyFiltered)).toBeVisible();
  await main(page).getByRole("link", { name: A6.clear }).filter({ visible: true }).last().click();
  await page.waitForURL("**/admin/customers");
  await expect(bodyRows(page).first()).toBeVisible();
});
