import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCustomer, createSubscription, logInAsAdmin, logInAsCrew } from "./helpers/admin";
import { screenshot } from "./helpers/auth";
import { baghdadDate, createOrder, createSlot } from "./helpers/booking";
import { admin } from "./helpers/supabase";

// Revenue and debts (spec §8.3 A18; Phase 7, task 2). Tests share one local
// database with parallel tests, so each makes its own customers, orders,
// boxes and sales and checks only those; the month's totals are everyone's.
// None moves the books' start day.

const { Admin, Crew } = messages;
const F = Admin.finance;

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

const unique = () => String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 100));

/** A cash box of the test's own, so its balance is the test's alone. */
async function createBox(name: string) {
  await admin.from("finance_accounts").insert({ kind: "cash", name }).throwOnError();
}

async function balanceOf(name: string) {
  const { data: box } = await admin
    .from("finance_accounts")
    .select("id")
    .eq("name", name)
    .single()
    .throwOnError();
  const { data } = await admin
    .from("finance_account_balances")
    .select("balance_iqd")
    .eq("account_id", box.id)
    .single()
    .throwOnError();
  return Number(data.balance_iqd);
}

function accountCard(page: Page) {
  return page
    .getByRole("dialog")
    .locator("div")
    .filter({ has: page.getByRole("heading", { level: 2, name: F.account.title, exact: true }) })
    .last();
}

test("الإيرادات والديون is a tab under الحسابات", async ({ page }) => {
  await logInAsAdmin(page);
  await page.goto("/admin/finance");
  const tabs = page.getByRole("navigation", { name: F.tabs.label });
  await tabs.getByRole("link", { name: F.tabs.revenue, exact: true }).click();
  await expect(page).toHaveURL("/admin/finance/revenue");
  await expect(page.getByRole("heading", { level: 1, name: F.revenue.title })).toBeVisible();
  for (const label of [F.revenue.revenue, F.revenue.received, F.revenue.owed, F.revenue.credit]) {
    await expect(
      page.getByRole("region", { name: F.revenue.summaryTitle }).getByText(label, { exact: true }),
    ).toBeVisible();
  }
  await screenshot(page, "admin-revenue");
});

test("the crew's cash is recorded into its box, and A2 shows the order settled", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const slot = await createSlot();
  const customer = await createCustomer("زبون العهدة");

  const crewContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const crewPage = await crewContext.newPage();
  const crew = await logInAsCrew(crewPage);
  const order = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(0),
    status: "in_progress",
    crewId: crew.id,
  });
  await crewPage.goto(`/crew/jobs/${order.id}`);
  await crewPage.getByRole("button", { name: Crew.steps.finish }).click();
  const sheet = crewPage.getByRole("dialog", { name: Crew.finish.title });
  await sheet.getByLabel(Crew.finish.sterilant).fill("كلور");
  await sheet.getByRole("checkbox").check();
  await sheet.getByRole("button", { name: Crew.finish.confirm }).click();
  await expect(crewPage.getByText(Crew.job.closed)).toBeVisible();
  await crewContext.close();

  const { data: payment } = await admin
    .from("finance_payments")
    .select("amount_iqd, automatic, account:finance_accounts(crew_id)")
    .eq("order_id", order.id)
    .single()
    .throwOnError();
  expect(payment).toMatchObject({
    amount_iqd: 35000,
    automatic: true,
    account: { crew_id: crew.id },
  });

  await logInAsAdmin(page);
  await page.goto(`/admin/orders?order=${order.id}`);
  const card = accountCard(page);
  await expect(card).toContainText(F.account.settled);
  await expect(card).toContainText(F.payment.automatic);
  await expect(card).toContainText(`عهدة ${crew.name}`);
});

test("an admin records a payment, a discount and a refund on a completed order", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const slot = await createSlot();
  const name = `زبون ${unique()}`;
  const box = `صندوق ${unique()}`;
  const customer = await createCustomer(name);
  await createBox(box);
  const order = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(0),
    status: "completed",
  });

  await logInAsAdmin(page);
  await page.goto(`/admin/orders?order=${order.id}`);
  let card = accountCard(page);
  await expect(card).toContainText(F.account.owes);
  await expect(card).toContainText("35,000");

  // A part payment into the test's box.
  await card.getByRole("button", { name: F.payment.new }).click();
  let form = card.getByRole("form", { name: F.payment.newTitle });
  await form.getByLabel(F.payment.account).selectOption({ label: box });
  await form.getByLabel(F.amount).fill("20000");
  await form.getByRole("button", { name: F.payment.create }).click();
  card = accountCard(page);
  await expect(card).toContainText("15,000");
  expect(await balanceOf(box)).toBe(20000);

  // A discount lives in the books only.
  await card.getByRole("button", { name: F.discount.new }).click();
  form = card.getByRole("form", { name: F.discount.newTitle });
  await form.getByLabel(F.amount).fill("5000");
  await form.getByLabel(F.discount.reason).fill("زبون دائم");
  await form.getByRole("button", { name: F.discount.create }).click();
  await expect(accountCard(page)).toContainText("10,000");
  const { data: stored } = await admin
    .from("orders")
    .select("total_iqd")
    .eq("id", order.id)
    .single()
    .throwOnError();
  expect(stored.total_iqd).toBe(35000);

  // A18 lists the customer as owing; their account takes the rest and more.
  await page.goto("/admin/finance/revenue");
  const owed = page.getByRole("table", { name: F.revenue.owedTitle });
  await owed.getByRole("link", { name: new RegExp(name) }).click();
  const drawer = page.getByRole("dialog", {
    name: F.revenue.customerTitle.replace("{name}", name),
  });
  await drawer.getByRole("button", { name: F.payment.new }).click();
  form = drawer.getByRole("form", { name: F.payment.newTitle });
  await expect(form.getByLabel(F.amount)).toHaveValue("10,000");
  await form.getByLabel(F.payment.account).selectOption({ label: box });
  await form.getByLabel(F.amount).fill("15000");
  await form.getByRole("button", { name: F.payment.create }).click();
  await expect(drawer).toContainText(F.account.credit);

  // Paying more shows as credit; a refund gives it back.
  await page.goto("/admin/finance/revenue");
  const credit = page.getByRole("table", { name: F.revenue.creditTitle });
  await expect(credit.getByRole("row").filter({ hasText: name })).toContainText("5,000");
  await page.goto(`/admin/orders?order=${order.id}`);
  card = accountCard(page);
  await card.getByRole("button", { name: F.payment.refund }).click();
  form = card.getByRole("form", { name: F.payment.refundTitle });
  await form.getByLabel(F.payment.refundAccount).selectOption({ label: box });
  await form.getByLabel(F.amount).fill("5000");
  await form.getByRole("button", { name: F.payment.createRefund }).click();
  await expect(accountCard(page)).toContainText(F.account.settled);
  expect(await balanceOf(box)).toBe(30000);
  await screenshot(page, "admin-order-account");
});

test("a manual sale paid into a box, then voided with its payment", async ({ page }) => {
  const box = `صندوق ${unique()}`;
  const customer = `موكب ${unique()}`;
  await createBox(box);
  await logInAsAdmin(page);
  await page.goto("/admin/finance/revenue");
  await page.getByRole("link", { name: F.revenue.newSale }).first().click();
  const form = page.getByRole("form", { name: F.sale.newTitle });
  await form.getByLabel(F.sale.customer).fill(customer);
  await form.getByLabel(F.sale.phone).fill("07801234567");
  await form.getByLabel(F.sale.service).fill("تنظيف 6 خزانات");
  await form.getByLabel(F.sale.place).fill("طريق النجف");
  await form.getByLabel(F.amount).fill("180000");
  await form.getByLabel(F.sale.paidNow).selectOption({ label: box });
  await form.getByRole("button", { name: F.sale.create }).click();

  // It opens again with its account, paid.
  const drawer = page.getByRole("dialog", { name: F.sale.editTitle });
  await expect(drawer).toContainText(F.account.settled);
  expect(await balanceOf(box)).toBe(180000);
  await screenshot(page, "admin-manual-sale");

  await drawer.getByRole("button", { name: F.sale.voidTitle }).click();
  await drawer.getByLabel(F.voidReason).fill("مكرر");
  await drawer.getByRole("button", { name: F.voidConfirm }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page
    .getByRole("table", { name: F.revenue.salesTitle })
    .getByRole("row")
    .filter({ hasText: customer });
  await expect(row).toContainText(F.voided);
  expect(await balanceOf(box)).toBe(0);
});

test("a subscription's payment ticks A7's paid", async ({ page }) => {
  const box = `صندوق ${unique()}`;
  const customer = await createCustomer();
  await createBox(box);
  const subscription = await createSubscription(customer.phone);
  // Activated now (60,000 IQD), so in the books.
  await logInAsAdmin(page);
  await page.goto(`/admin/subscriptions?subscription=${subscription.id}`);
  const card = accountCard(page);
  await expect(card).toContainText("60,000");
  await card.getByRole("button", { name: F.payment.new }).click();
  const form = card.getByRole("form", { name: F.payment.newTitle });
  await expect(form.getByLabel(F.amount)).toHaveValue("60,000");
  await form.getByLabel(F.payment.account).selectOption({ label: box });
  await form.getByRole("button", { name: F.payment.create }).click();
  await expect(accountCard(page)).toContainText(F.account.settled);
  const { data } = await admin
    .from("subscriptions")
    .select("paid")
    .eq("id", subscription.id)
    .single()
    .throwOnError();
  expect(data.paid).toBe(true);
  // A7's own switch is gone for a subscription in the books.
  await expect(
    page.getByRole("button", { name: Admin.subscriptions.drawer.markUnpaid }),
  ).toHaveCount(0);
});
