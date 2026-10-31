import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCrew, logInAsAdmin } from "./helpers/admin";
import { screenshot } from "./helpers/auth";
import { baghdadDate } from "./helpers/booking";
import { admin } from "./helpers/supabase";

// Stock (spec §8.3 A23; Phase 7, task 6). The test makes its own item, box,
// expense and crew with names of their own and checks only those rows, so
// parallel tests never read each other's. None moves the start day or closes
// a month.

const { Admin } = messages;
const F = Admin.finance;
const S = F.stock;

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

const unique = () => String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 100));

function itemRow(page: Page, name: string) {
  return page
    .getByRole("table", { name: S.itemsCaption })
    .first()
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name }) });
}

function drawer(page: Page) {
  return page.getByRole("dialog");
}

test("an admin keeps stock: items, ins linked to expenses, outs, counts and low stock", async ({
  page,
}) => {
  const id = unique();
  const item = `كلور ${id}`;
  const box = `قاصة المخزن ${id}`;
  const crew = await createCrew();
  const { data: account } = await admin
    .from("finance_accounts")
    .insert({ kind: "cash", name: box })
    .select("id")
    .single()
    .throwOnError();
  const { data: category } = await admin
    .from("expense_categories")
    .insert({ name: `مواد ${id}`, kind: "general" })
    .select("id")
    .single()
    .throwOnError();

  const { id: adminId } = await logInAsAdmin(page);
  const { data: expense } = await admin
    .from("expenses")
    .insert({
      spent_on: baghdadDate(0),
      category_id: category.id,
      account_id: account.id,
      amount_iqd: 45000,
      note: `شوالات كلور ${id}`,
      created_by: adminId,
    })
    .select("id")
    .single()
    .throwOnError();

  await page.goto("/admin/finance/overview");
  await page
    .getByRole("navigation", { name: F.tabs.label })
    .getByRole("link", { name: F.tabs.stock, exact: true })
    .click();
  await expect(page).toHaveURL("/admin/finance/stock");
  await expect(page.getByRole("heading", { level: 1, name: S.title })).toBeVisible();

  // A new item, minimum 5 kilos: its drawer opens once added.
  await page.getByRole("link", { name: S.newItem }).click();
  const form = drawer(page).getByRole("form", { name: S.item.newTitle });
  await form.getByLabel(S.item.name).fill(item);
  await form.getByLabel(S.item.unit).fill("كيلو");
  await form.getByLabel(S.item.minimum).fill("5");
  await form.getByRole("button", { name: S.item.create }).click();
  await expect(drawer(page).getByRole("heading", { name: item })).toBeVisible();

  // An in of 10 from the item's drawer.
  await drawer(page).getByRole("link", { name: S.receive }).click();
  const receive = drawer(page).getByRole("form", { name: S.move.newTitle.in });
  await expect(receive.getByLabel(S.move.item)).toHaveValue(/.+/);
  await receive.getByLabel(new RegExp(S.move.quantity)).fill("10");
  await receive.getByRole("button", { name: S.move.create }).click();
  await expect(drawer(page)).toBeHidden();
  await expect(itemRow(page, item)).toContainText("10");
  await expect(itemRow(page, item)).toContainText(S.ok);

  // 2.5 more paid by an expense, from A16's drawer.
  await page.goto(`/admin/finance/expenses?expense=${expense.id}`);
  await expect(drawer(page).getByText(S.expenseNone)).toBeVisible();
  await drawer(page).getByRole("link", { name: S.expenseAdd }).click();
  await expect(page).toHaveURL(/\/admin\/finance\/stock\?move=new&kind=in&expense=/);
  const linked = drawer(page).getByRole("form", { name: S.move.newTitle.in });
  await expect(linked.getByLabel(S.move.expense)).toHaveValue(expense.id);
  await linked.getByLabel(S.move.item).selectOption({ label: item });
  await linked.getByLabel(new RegExp(S.move.quantity)).fill("2.5");
  await linked.getByRole("button", { name: S.move.create }).click();
  await expect(drawer(page)).toBeHidden();
  await expect(itemRow(page, item)).toContainText("12.5");

  // The expense lists it, and isn't voided while it does.
  await page.goto(`/admin/finance/expenses?expense=${expense.id}`);
  await expect(drawer(page).getByRole("link", { name: new RegExp(item) })).toBeVisible();
  await drawer(page).getByRole("button", { name: F.expense.voidTitle }).click();
  const voidForm = drawer(page).getByRole("form", { name: F.expense.voidTitle });
  await voidForm.getByLabel(F.voidReason).fill("خطأ");
  await voidForm.getByRole("button", { name: F.voidConfirm }).click();
  await expect(drawer(page).getByText(Admin.editErrors.expense_has_stock)).toBeVisible();

  // An out beyond what is there is refused; one of 8 to the crew leaves 4.5, low.
  await page.goto("/admin/finance/stock");
  await page.getByRole("link", { name: S.use }).click();
  const use = drawer(page).getByRole("form", { name: S.move.newTitle.out });
  await use.getByLabel(S.move.item).selectOption({ label: item });
  await use.getByLabel(new RegExp(S.move.quantity)).fill("20");
  await use.getByLabel(S.move.crew).selectOption({ label: crew.name });
  await use.getByRole("button", { name: S.move.create }).click();
  await expect(use.getByText(Admin.editErrors.stock_too_low)).toBeVisible();
  await use.getByLabel(new RegExp(S.move.quantity)).fill("8");
  await use.getByRole("button", { name: S.move.create }).click();
  await expect(drawer(page)).toBeHidden();
  await expect(itemRow(page, item)).toContainText("4.5");
  await expect(itemRow(page, item)).toContainText(S.low);
  await expect(
    page.getByRole("row").filter({ hasText: S.crew.replace("{crew}", crew.name) }),
  ).toBeVisible();

  // Every admin was told once.
  const { data: notices } = await admin
    .from("notifications")
    .select("id")
    .eq("type", "stock_low")
    .eq("user_id", adminId)
    .eq("data->>item_id", (await itemId(item)) ?? "")
    .throwOnError();
  expect(notices).toHaveLength(1);

  // A19 lists it with its quantity and minimum.
  await page.goto("/admin/finance/overview");
  const card = page.getByRole("listitem").filter({ hasText: item });
  await expect(card).toContainText(
    S.overviewLine.replace("{quantity}", "4.5").replace("{minimum}", "5").replace("{unit}", "كيلو"),
  );
  await card.getByRole("link", { name: item }).click();
  await expect(drawer(page).getByRole("heading", { name: item })).toBeVisible();

  // A count of 6 sets it; the month shows the correction.
  await page.goto("/admin/finance/stock");
  await page.getByRole("link", { name: S.count }).click();
  const count = drawer(page).getByRole("form", { name: S.move.newTitle.count });
  await count.getByLabel(S.move.item).selectOption({ label: item });
  await count.getByLabel(new RegExp(S.move.counted)).fill("6");
  await count.getByRole("button", { name: S.move.create }).click();
  await expect(drawer(page)).toBeHidden();
  await expect(itemRow(page, item)).toContainText("6");
  await expect(itemRow(page, item)).toContainText(S.ok);
  const month = page
    .getByRole("table", { name: S.monthCaption })
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: item }) });
  await expect(month).toContainText("+1.5");
  await screenshot(page, "admin-stock");

  // Voiding the out: the count still stands.
  await page
    .getByRole("table", { name: S.movesCaption })
    .getByRole("row")
    .filter({ hasText: S.crew.replace("{crew}", crew.name) })
    .getByRole("link")
    .click();
  await drawer(page).getByRole("button", { name: S.move.voidTitle }).click();
  const voidMove = drawer(page).getByRole("form", { name: S.move.voidTitle });
  await voidMove.getByLabel(F.voidReason).fill("مكرر");
  await voidMove.getByRole("button", { name: F.voidConfirm }).click();
  await expect(drawer(page)).toBeHidden();
  await expect(itemRow(page, item)).toContainText("6");
});

async function itemId(name: string): Promise<string | null> {
  const { data } = await admin.from("stock_items").select("id").eq("name", name).maybeSingle();
  return data?.id ?? null;
}
