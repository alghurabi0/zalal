import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCrew, logInAsAdmin } from "./helpers/admin";
import { screenshot } from "./helpers/auth";
import { admin } from "./helpers/supabase";

// Accounting (spec §8.3 A15–A17; Phase 7, task 1). Tests share one local
// database with parallel tests, so each makes its own boxes, categories and
// crews with names of their own and checks only those balances. None moves
// the books' start day, which every test sees.

const { Admin } = messages;
const F = Admin.finance;

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

const unique = () => String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 100));

function boxCard(page: Page, name: string) {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) });
}

function settingsRow(page: Page, name: string) {
  return page.getByRole("row").filter({ has: page.getByRole("rowheader", { name, exact: true }) });
}

/** Adds a box on A17 with its opening balance. */
async function addBox(page: Page, name: string, opening: string) {
  await page.goto("/admin/finance/settings");
  await page.getByRole("button", { name: F.settings.addBox }).click();
  const form = page.getByRole("form", { name: F.settings.addBox });
  await form.getByLabel(F.settings.boxName).fill(name);
  await form.getByLabel(F.settings.opening).fill(opening);
  await form.getByRole("button", { name: F.settings.addBox }).click();
  await expect(page.getByRole("status").getByText(F.settings.boxAdded)).toBeVisible();
}

async function addCategory(page: Page, name: string) {
  await page.goto("/admin/finance/settings");
  await page.getByRole("button", { name: F.settings.addCategory }).click();
  const form = page.getByRole("form", { name: F.settings.addCategory });
  await form.getByLabel(F.settings.categoryName).fill(name);
  await form.getByRole("button", { name: F.settings.addCategory }).click();
  await expect(page.getByRole("status").getByText(F.settings.categoryAdded)).toBeVisible();
}

test("the sidebar's الحسابات opens the overview and reaches every tab", async ({ page }) => {
  await logInAsAdmin(page);
  const nav = page.getByRole("navigation", { name: Admin.nav.label });
  await nav.getByRole("link", { name: Admin.nav.finance, exact: true }).click();
  await expect(page).toHaveURL("/admin/finance/overview");
  await expect(page.getByRole("heading", { level: 1, name: F.overview.title })).toBeVisible();
  await expect(nav.getByRole("link", { name: Admin.nav.finance, exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const tabs = page.getByRole("navigation", { name: F.tabs.label });
  for (const [tab, url, heading] of [
    [F.tabs.expenses, "/admin/finance/expenses", F.expenses.title],
    [F.tabs.reports, "/admin/finance/reports", F.reports.title],
    [F.tabs.settings, "/admin/finance/settings", F.settings.title],
    [F.tabs.boxes, "/admin/finance", F.boxes.title],
    [F.tabs.overview, "/admin/finance/overview", F.overview.title],
  ] as const) {
    await tabs.getByRole("link", { name: tab, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    // The sidebar keeps الحسابات marked on every accounting page.
    await expect(nav.getByRole("link", { name: Admin.nav.finance, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
});

test("an admin records, edits and voids an expense, and the box follows", async ({ page }) => {
  await logInAsAdmin(page);
  const id = unique();
  const box = `صندوق ${id}`;
  const category = `باب ${id}`;
  const note = `كلور ${id}`;
  await addBox(page, box, "100,000");
  await addCategory(page, category);
  await screenshot(page, "admin-finance-settings");

  await page.goto("/admin/finance/expenses");
  await page.getByRole("link", { name: F.expenses.new }).click();
  const drawer = page.getByRole("dialog", { name: F.expense.newTitle });
  await drawer.getByLabel(F.expense.category).selectOption({ label: category });
  await drawer.getByLabel(F.expense.account).selectOption({ label: box });
  await drawer.getByLabel(F.amount).fill("0");
  await drawer.getByLabel(F.expense.note).fill(note);
  await drawer.getByRole("button", { name: F.expense.create }).click();
  await expect(drawer.getByText(F.amountRange)).toBeVisible();
  await drawer.getByLabel(F.amount).fill("45,000");
  await drawer.getByRole("button", { name: F.expense.create }).click();
  await expect(drawer).toBeHidden();

  const row = page.getByRole("row").filter({ hasText: note });
  await expect(row).toContainText(category);
  await expect(row).toContainText(box);
  await expect(row).toContainText("45,000");
  await screenshot(page, "admin-finance-expenses");

  await page.goto("/admin/finance");
  await expect(boxCard(page, box)).toContainText("55,000");

  // Edit: a smaller amount.
  await page.goto("/admin/finance/expenses");
  await page.getByRole("row").filter({ hasText: note }).getByRole("link").click();
  const edit = page.getByRole("dialog", { name: F.expense.editTitle });
  await expect(edit.getByLabel(F.amount)).toHaveValue("45,000");
  await edit.getByLabel(F.amount).fill("40000");
  await edit.getByRole("button", { name: F.save, exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: note })).toContainText("40,000");

  // Void: a reason first, then it leaves the list and the balance.
  await page.getByRole("row").filter({ hasText: note }).getByRole("link").click();
  const voiding = page.getByRole("dialog", { name: F.expense.editTitle });
  await voiding.getByRole("button", { name: F.expense.voidTitle }).click();
  const voidForm = voiding.getByRole("form", { name: F.expense.voidTitle });
  await voidForm.getByRole("button", { name: F.voidConfirm }).click();
  await expect(voidForm.getByText(Admin.editErrors.reason_required)).toBeVisible();
  await voidForm.getByLabel(F.voidReason).fill("انسجل غلط");
  await voidForm.getByRole("button", { name: F.voidConfirm }).click();
  await expect(voiding).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: note })).toHaveCount(0);

  await page.getByRole("link", { name: F.expenses.showVoided }).click();
  await page.getByRole("row").filter({ hasText: note }).getByRole("link").click();
  await expect(page.getByRole("dialog")).toContainText("انسجل غلط");
  await expect(page.getByRole("dialog").getByRole("button", { name: F.save })).toHaveCount(0);

  await page.goto("/admin/finance");
  await expect(boxCard(page, box)).toContainText("100,000");
});

test("a crew hands in its cash with استلم المبلغ", async ({ page }) => {
  const crew = await createCrew();
  const { data: box } = await admin
    .from("finance_accounts")
    .update({ opening_balance_iqd: 75000 })
    .eq("crew_id", crew.id)
    .select("id")
    .single()
    .throwOnError();
  await logInAsAdmin(page);
  await page.goto("/admin/finance");

  const crewBox = fill(F.crewBox, { crew: crew.name });
  const card = boxCard(page, crewBox);
  await expect(card).toContainText("75,000");
  await screenshot(page, "admin-finance-boxes");
  await card.getByRole("link", { name: `${F.boxes.handover} ${crewBox}` }).click();

  const drawer = page.getByRole("dialog", {
    name: fill(F.transfer.handoverTitle, { name: crewBox }),
  });
  await expect(drawer.getByLabel(F.transfer.from)).toHaveValue(box!.id);
  await expect(drawer.getByLabel(F.amount)).toHaveValue("75,000");
  await expect(drawer.getByLabel(F.transfer.to)).not.toHaveValue("");
  await drawer.getByRole("button", { name: F.transfer.create }).click();
  await expect(drawer).toBeHidden();

  await expect(boxCard(page, crewBox)).toContainText("0");
  await expect(boxCard(page, crewBox).getByRole("link", { name: /استلم/ })).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: crewBox })).toContainText("75,000");
});

test("a used category can't be deleted; an unused one can", async ({ page }) => {
  await logInAsAdmin(page);
  const id = unique();
  const used = `مستعمل ${id}`;
  const unused = `فاضي ${id}`;
  await addCategory(page, used);
  await addCategory(page, unused);
  const { data: category } = await admin
    .from("expense_categories")
    .select("id")
    .eq("name", used)
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
  const { data: someAdmin } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .limit(1)
    .single()
    .throwOnError();
  await admin
    .from("expenses")
    .insert({
      spent_on: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date()),
      category_id: category!.id,
      account_id: cash!.id,
      amount_iqd: 1000,
      created_by: someAdmin!.id,
    })
    .throwOnError();
  await page.reload();

  await settingsRow(page, used)
    .getByRole("button", { name: fill(F.editLabel, { name: used }) })
    .click();
  await page.getByRole("button", { name: F.settings.deleteCategory }).click();
  await expect(page.getByText(Admin.editErrors.expense_category_in_use)).toBeVisible();

  await settingsRow(page, unused)
    .getByRole("button", { name: fill(F.editLabel, { name: unused }) })
    .click();
  await page.getByRole("button", { name: F.settings.deleteCategory }).click();
  await expect(page.getByRole("status").getByText(F.settings.categoryDeleted)).toBeVisible();
  await expect(settingsRow(page, unused)).toHaveCount(0);
});

function fill(text: string, values: Record<string, string>) {
  return Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, v), text);
}
