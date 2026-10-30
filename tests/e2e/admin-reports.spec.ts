import { readFile } from "node:fs/promises";

import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCrew, logInAsAdmin } from "./helpers/admin";
import { screenshot } from "./helpers/auth";
import { baghdadDate } from "./helpers/booking";
import { admin } from "./helpers/supabase";

// Accounting overview and reports (spec §8.3 A19–A20; Phase 7, task 3).
// Tests share one local database with parallel tests, so each makes its own
// expense category, expenses and crew and checks only those lines: the
// month's totals are every test's. Month close is global (it stops every
// test's records in that month), so it is tested in system-states.spec.ts.

const { Admin } = messages;
const F = Admin.finance;

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

const unique = () => String(Date.now()).slice(-6) + String(Math.floor(Math.random() * 100));

/** A category of this test's own with one expense today from the cash box. */
async function spend(adminId: string, amount: number) {
  const name = `باب ${unique()}`;
  const { data: category } = await admin
    .from("expense_categories")
    .insert({ name })
    .select("id")
    .single()
    .throwOnError();
  const { data: cash } = await admin
    .from("finance_accounts")
    .select("id")
    .eq("kind", "cash")
    .order("created_at")
    .limit(1)
    .single()
    .throwOnError();
  await admin
    .from("expenses")
    .insert({
      spent_on: baghdadDate(0),
      category_id: category.id,
      account_id: cash.id,
      amount_iqd: amount,
      created_by: adminId,
    })
    .throwOnError();
  return { name, cashId: cash.id };
}

function lineRow(page: Page, label: string) {
  return page
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
}

test("the overview shows where the money went, the last 6 months and crew cash", async ({
  page,
}) => {
  const { id } = await logInAsAdmin(page);
  const { name, cashId } = await spend(id, 12345);
  const crew = await createCrew();
  const { data: box } = await admin
    .from("finance_accounts")
    .select("id")
    .eq("crew_id", crew.id)
    .single()
    .throwOnError();
  await admin
    .from("finance_transfers")
    .insert({
      moved_on: baghdadDate(0),
      from_account_id: cashId,
      to_account_id: box.id,
      amount_iqd: 25000,
      created_by: id,
    })
    .throwOnError();

  await page.goto("/admin/finance/overview");
  await expect(page.getByRole("heading", { level: 1, name: F.overview.title })).toBeVisible();

  const where = page.getByRole("listitem").filter({ hasText: name });
  await expect(where).toContainText("12,345");

  const crewName = F.crewBox.replace("{crew}", crew.name);
  const crewRow = page.getByRole("listitem").filter({ hasText: crewName });
  await expect(crewRow).toContainText("25,000");
  await crewRow.getByRole("link", { name: new RegExp(F.boxes.handover) }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/finance\\?transfer=new&from=${box.id}`));
  await page.goBack();

  // Six months, each with its numbers in the table under the bars.
  const months = page.getByRole("table", { name: F.overview.chartCaption });
  await expect(months.getByRole("rowheader")).toHaveCount(6);
  await screenshot(page, "admin-finance-overview");
});

test("the month's profit and loss lists its expenses by category, downloads and prints", async ({
  page,
}) => {
  const { id } = await logInAsAdmin(page);
  const { name } = await spend(id, 7777);

  await page.goto("/admin/finance/reports");
  await expect(page.getByRole("heading", { level: 1, name: F.reports.title })).toBeVisible();
  await expect(lineRow(page, name)).toContainText("7,777");
  for (const section of Object.values(F.reports.sections).filter((s) => s !== "النتيجة")) {
    await expect(page.getByRole("columnheader", { name: section, exact: true })).toBeVisible();
  }
  await expect(lineRow(page, F.reports.figures.profit)).toBeVisible();
  // This month hasn't ended, so it can't close yet.
  await expect(page.getByText(F.reports.notEnded)).toBeVisible();
  await screenshot(page, "admin-finance-reports-month");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: F.reports.csv }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`zalal-report-${baghdadDate(0).slice(0, 7)}.csv`);
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv.startsWith("﻿")).toBe(true);
  expect(csv).toContain(`${name},7777`);
  expect(csv).toContain(F.reports.figures.netCash);

  await page.evaluate(() => {
    window.print = () => document.body.setAttribute("data-printed", "1");
  });
  await page.getByRole("button", { name: F.reports.print }).click();
  await expect(page.locator("body")).toHaveAttribute("data-printed", "1");
});

test("the year shows twelve months side by side", async ({ page }) => {
  const { id } = await logInAsAdmin(page);
  const { name } = await spend(id, 4321);
  const year = baghdadDate(0).slice(0, 4);

  await page.goto("/admin/finance/reports");
  await page
    .getByRole("navigation", { name: F.reports.viewLabel })
    .getByRole("link", { name: F.reports.yearView })
    .click();
  await expect(page).toHaveURL(`/admin/finance/reports?year=${year}`);
  await expect(
    page.getByRole("heading", { name: F.reports.yearTitle.replace("{year}", year) }),
  ).toBeVisible();
  // The line, twelve months and the total.
  await expect(page.getByRole("row").first().getByRole("columnheader")).toHaveCount(14);
  await expect(lineRow(page, name)).toContainText("4,321");
  await screenshot(page, "admin-finance-reports-year");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: F.reports.csv }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`zalal-report-${year}.csv`);
  const csv = await readFile((await download.path())!, "utf8");
  const month = Number(baghdadDate(0).slice(5, 7));
  const cells = csv
    .split("\r\n")
    .find((line) => line.startsWith(`${name},`))!
    .split(",");
  // The line's name, January … December, then the year's total.
  expect(cells).toHaveLength(14);
  expect(cells[month]).toBe("4321");
  expect(cells[13]).toBe("4321");
});
