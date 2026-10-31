import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { logInAsAdmin } from "./helpers/admin";
import { screenshot } from "./helpers/auth";
import { admin } from "./helpers/supabase";

// Partners and the balance sheet (spec §8.3 A22; Phase 7, task 5). The test
// makes its own partners, box and purchase with names of their own and checks
// only those rows, and that the balance sheet balances (true whatever other
// tests add). It sets this month's shares, which no other test reads. None
// moves the start day or closes a month.

const { Admin } = messages;
const F = Admin.finance;

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

const unique = () => String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 100));

function row(page: Page, name: string) {
  return page.getByRole("row").filter({ has: page.getByRole("rowheader", { name }) });
}

function drawer(page: Page) {
  return page.getByRole("dialog");
}

/** Adds a partner from A22: their drawer opens once added. */
async function addPartner(page: Page, name: string) {
  await page.getByRole("link", { name: F.partners.newPartner }).click();
  const form = drawer(page).getByRole("form", { name: F.partner.newTitle });
  await form.getByLabel(F.partner.name).fill(name);
  await form.getByRole("button", { name: F.partner.create }).click();
  await expect(drawer(page).getByRole("heading", { name })).toBeVisible();
}

test("an admin adds partners, their capital and shares, and spreads a purchase", async ({
  page,
}) => {
  const id = unique();
  const [first, second] = [`شريك أول ${id}`, `شريك ثاني ${id}`];
  const box = `قاصة الشركاء ${id}`;
  await admin.from("finance_accounts").insert({ kind: "cash", name: box }).throwOnError();

  await logInAsAdmin(page);
  await page.goto("/admin/finance/overview");
  await page
    .getByRole("navigation", { name: F.tabs.label })
    .getByRole("link", { name: F.tabs.partners, exact: true })
    .click();
  await expect(page).toHaveURL("/admin/finance/partners");
  await expect(page.getByRole("heading", { level: 1, name: F.partners.title })).toBeVisible();
  await expect(page.getByText(F.partners.balanced)).toBeVisible();

  // Two partners; the first puts in capital.
  await addPartner(page, first);
  const movement = drawer(page).getByRole("form", { name: F.partner.addMovement });
  await movement.getByLabel(F.partner.account).selectOption({ label: box });
  await movement.getByLabel(F.amount).fill("500,000");
  await movement.getByRole("button", { name: F.partner.addMovement }).click();
  await expect(drawer(page).getByRole("listitem").filter({ hasText: "500,000" })).toBeVisible();
  await page.goto("/admin/finance/partners");
  await addPartner(page, second);
  await page.goto("/admin/finance/partners");
  await expect(row(page, first)).toContainText("500,000");

  // This month's shares: 60% and 40%, every other partner none.
  await page.getByRole("link", { name: F.partners.sharesButton }).click();
  const shares = drawer(page).getByRole("form", { name: F.shares.title });
  const inputs = shares.getByRole("textbox");
  for (let i = 0; i < (await inputs.count()); i++) await inputs.nth(i).fill("");
  await shares.getByLabel(F.shares.shareOf.replace("{name}", first)).fill("60");
  await shares.getByLabel(F.shares.shareOf.replace("{name}", second)).fill("50");
  await shares.getByRole("button", { name: F.shares.save }).click();
  await expect(shares.getByText(F.shares.totalWrong, { exact: false })).toBeVisible();
  await shares.getByLabel(F.shares.shareOf.replace("{name}", second)).fill("40");
  await shares.getByRole("button", { name: F.shares.save }).click();
  await expect(shares.getByText(F.shares.saved)).toBeVisible();
  await page.goto("/admin/finance/partners");
  await expect(row(page, first)).toContainText(F.partners.share.replace("{share}", "60"));
  await expect(row(page, second)).toContainText(F.partners.share.replace("{share}", "40"));
  await expect(page.getByText(F.partners.balanced)).toBeVisible();

  // A pump bought today over 12 months: 10,000 a month.
  const pump = `مضخة ${id}`;
  await page.getByRole("link", { name: F.partners.buyEquipment }).first().click();
  const expense = page.getByRole("dialog", { name: F.expense.newTitle });
  await expense.getByLabel(F.expense.category).selectOption({ label: "شراء معدات" });
  await expense.getByLabel(F.expense.account).selectOption({ label: box });
  await expense.getByLabel(F.amount).fill("120000");
  await expect(expense.getByLabel(F.expense.life)).toHaveValue("36");
  await expense.getByLabel(F.expense.life).fill("12");
  await expense.getByLabel(F.expense.note).fill(pump);
  await expense.getByRole("button", { name: F.expense.create }).click();
  await expect(expense).toBeHidden();

  await page.goto("/admin/finance/partners");
  await expect(row(page, pump)).toContainText("10,000");
  await expect(row(page, pump)).toContainText("110,000");
  await screenshot(page, "admin-partners");

  // Written off today: no depreciation this month, and its whole cost a loss.
  await row(page, pump).getByRole("link", { name: pump }).click();
  const disposal = drawer(page).getByRole("form", { name: F.equipment.disposeTitle });
  await disposal.getByRole("button", { name: F.equipment.dispose }).click();
  await expect(drawer(page).getByText(F.equipment.writtenOff, { exact: false })).toBeVisible();
  await page.goto("/admin/finance/partners");
  await expect(row(page, pump)).toContainText(F.partners.disposedOn.split(" {")[0] ?? "");
  await expect(page.getByText(F.partners.balanced)).toBeVisible();

  // A20 counts the write-off, not the purchase.
  await page.goto("/admin/finance/reports");
  await expect(
    page.getByRole("row").filter({ hasText: F.reports.figures.equipmentResult }),
  ).toBeVisible();
});
