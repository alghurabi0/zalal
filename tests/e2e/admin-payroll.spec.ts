import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCrew, createCustomer, logInAsAdmin } from "./helpers/admin";
import { screenshot } from "./helpers/auth";
import { baghdadDate, createOrder, createSlot } from "./helpers/booking";
import { createWorker } from "./helpers/payroll";
import { admin } from "./helpers/supabase";

// Payroll (spec §8.3 A21; Phase 7, task 4). Each test makes its own workers
// and crews, with names of their own, and checks only their rows: the
// month's totals are every test's. None closes a month or moves the start day.

const { Admin } = messages;
const F = Admin.finance;

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

const unique = () => String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 100));

function workerRow(page: Page, name: string) {
  return page.getByRole("row").filter({ has: page.getByRole("rowheader", { name }) });
}

function drawer(page: Page) {
  return page.getByRole("dialog");
}

test("an admin adds a worker, pays per visit of their crew, and pays them from A16", async ({
  page,
}) => {
  const crew = await createCrew();
  const customer = await createCustomer();
  const slot = await createSlot();
  // The crew finished a job today.
  await createOrder(customer.phone, {
    slot,
    date: baghdadDate(0),
    status: "completed",
    crewId: crew.id,
  });
  const name = `عامل ${unique()}`;

  await logInAsAdmin(page);
  await page.goto("/admin/finance/overview");
  await page
    .getByRole("navigation", { name: F.tabs.label })
    .getByRole("link", { name: F.tabs.payroll, exact: true })
    .click();
  await expect(page).toHaveURL("/admin/finance/payroll");
  await expect(page.getByRole("heading", { level: 1, name: F.payroll.title })).toBeVisible();

  // Add the worker: the drawer opens on their account.
  await page.getByRole("link", { name: F.payroll.new }).click();
  const form = drawer(page).getByRole("form", { name: F.worker.newTitle });
  await form.getByLabel(F.worker.name).fill(name);
  await form.getByLabel(F.worker.phone).fill("07801234567");
  await form.getByRole("button", { name: F.worker.create }).click();
  await expect(drawer(page).getByRole("heading", { name })).toBeVisible();
  await expect(drawer(page).getByText(F.worker.noCurrentCrew)).toBeVisible();

  // Into the crew from today, at 10,000 a visit from today.
  const move = drawer(page).getByRole("form", { name: F.worker.move });
  await move.getByLabel(F.worker.moveTo).selectOption({ label: crew.name });
  await move.getByRole("button", { name: F.worker.move }).click();
  await expect(
    drawer(page).getByText(F.worker.currentCrew.replace("{crew}", crew.name)),
  ).toBeVisible();
  const rate = drawer(page).getByRole("form", { name: F.worker.addRate });
  await rate.getByLabel(F.worker.rateType).selectOption({ label: F.payroll.payTypes.per_visit });
  await rate.getByLabel(F.amount).fill("10000");
  await rate.getByRole("button", { name: F.worker.addRate }).click();
  await expect(drawer(page).getByRole("listitem").filter({ hasText: "10,000" })).toBeVisible();

  // A bonus this month.
  const bonus = drawer(page).getByRole("form", { name: F.worker.adjustmentsTitle });
  await bonus.getByLabel(F.amount).fill("2500");
  await bonus.getByLabel(F.worker.adjustmentReason).fill("شغل زايد");
  await bonus.getByRole("button", { name: F.worker.addAdjustment }).click();
  await expect(drawer(page).getByText("شغل زايد")).toBeVisible();

  // Earned: the crew's visit today + the bonus; nothing paid, so it's owed.
  const summary = drawer(page).getByRole("definition");
  await expect(summary.filter({ hasText: "12,500" }).first()).toBeVisible();
  await screenshot(page, "admin-payroll-worker");

  // "ادفع له": A16's drawer with the wages category, the worker and what they're owed.
  await drawer(page).getByRole("link", { name: F.worker.pay }).click();
  await expect(page).toHaveURL(/\/admin\/finance\/expenses\?expense=new&worker=/);
  const expense = drawer(page).getByRole("form", { name: F.expense.newTitle });
  await expect(expense.getByLabel(F.expense.worker)).toHaveValue(/.+/);
  await expect(expense.getByLabel(F.amount)).toHaveValue("12,500");
  await expense.getByRole("button", { name: F.expense.create }).click();
  await expect(drawer(page)).toBeHidden();

  // Paid in full: the payroll row is settled.
  await page.goto("/admin/finance/payroll");
  const row = workerRow(page, name);
  await expect(row.getByText(F.payroll.settled)).toBeVisible();
  await expect(row.getByText(F.payroll.payTypes.per_visit)).toBeVisible();
  await expect(row.getByRole("cell", { name: crew.name })).toBeVisible();
  await screenshot(page, "admin-payroll");
});

test("days worked: the crew's work days tick at once, and an advance shows", async ({ page }) => {
  const crew = await createCrew();
  const customer = await createCustomer();
  const slot = await createSlot();
  await createOrder(customer.phone, {
    slot,
    date: baghdadDate(0),
    status: "completed",
    crewId: crew.id,
  });
  const { id: adminId } = await logInAsAdmin(page);
  const worker = await createWorker({ createdBy: adminId, crewId: crew.id, amountIqd: 15000 });
  // Paid 40,000 ahead.
  const { data: wages } = await admin
    .from("expense_categories")
    .select("id")
    .eq("kind", "wages")
    .eq("active", true)
    .limit(1)
    .single()
    .throwOnError();
  const { data: cash } = await admin
    .from("finance_accounts")
    .select("id")
    .eq("kind", "cash")
    .eq("active", true)
    .limit(1)
    .single()
    .throwOnError();
  await admin
    .from("expenses")
    .insert({
      spent_on: baghdadDate(0),
      category_id: wages.id,
      account_id: cash.id,
      amount_iqd: 40000,
      worker_id: worker.id,
      created_by: adminId,
    })
    .throwOnError();

  await page.goto(`/admin/finance/payroll?worker=${worker.id}`);
  const days = drawer(page).getByRole("form", { name: F.worker.daysTitle });
  await days.getByRole("button", { name: F.worker.fillCrewDays }).click();
  await days.getByRole("button", { name: F.worker.saveDays }).click();
  // One day at 15,000 against 40,000 paid: an advance of 25,000.
  await expect(drawer(page).getByRole("definition").filter({ hasText: "−25,000" })).toBeVisible();

  await page.goto("/admin/finance/payroll");
  const row = workerRow(page, worker.name);
  await expect(row.getByText(F.payroll.advance)).toBeVisible();
  await expect(row.getByText("25,000")).toBeVisible();

  // A16 shows the wage under its category, with the worker.
  await page.goto("/admin/finance/expenses");
  await expect(page.getByRole("cell", { name: worker.name })).toBeVisible();
});
