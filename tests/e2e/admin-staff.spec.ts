import { type Browser, expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCrew, createCustomer, logInAsAdmin } from "./helpers/admin";
import { e164, enterCode, newPhone, requestCode, screenshot } from "./helpers/auth";
import { baghdadDate, createOrder, createSlot, disableSlot } from "./helpers/booking";
import { admin } from "./helpers/supabase";

// Admin dashboard, part C (spec §8.2): Crews (A10), Admins (A14) and the
// audit log. Tests share one local database with parallel tests, so each
// makes its own crews, customers and admins with fresh phones and only
// switches off or removes those.

const { Admin } = messages;
const { crews: Crews, admins: Admins, audit: Audit, editErrors } = Admin;

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), text);

/** Logs this phone in on a fresh browser and returns where it lands. */
async function logInElsewhere(browser: Browser, phone: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await requestCode(page, phone);
  await enterCode(page, phone);
  return page;
}

function crewRow(page: Page, name: string) {
  return page.getByRole("row").filter({ has: page.getByRole("rowheader", { name, exact: true }) });
}

test("the admin nav reaches Crews, Admins and the audit log", async ({ page }) => {
  await logInAsAdmin(page);
  const nav = page.getByRole("navigation", { name: Admin.nav.label });
  for (const [name, url, heading] of [
    [Admin.nav.crews, "/admin/crews", Crews.title],
    [Admin.nav.admins, "/admin/admins", Admins.title],
    [Admin.nav.audit, "/admin/audit", Audit.title],
  ] as const) {
    await nav.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
});

test("an admin adds a crew with a new phone, and the crew logs in", async ({ page, browser }) => {
  await logInAsAdmin(page);
  await page.goto("/admin/crews");
  const phone = newPhone();
  const name = `فريق ${phone.slice(-5)}`;

  await page.getByRole("button", { name: Crews.add }).click();
  const form = page.getByRole("form", { name: Crews.addTitle });
  await form.getByLabel(Crews.name).fill(name);
  await form.getByLabel(Crews.phone).fill("0780");
  await expect(form.getByText(Crews.phoneInvalid)).toBeVisible();
  await expect(form.getByRole("button", { name: Crews.create })).toBeDisabled();
  await form.getByLabel(Crews.phone).fill(phone);
  await form.getByRole("button", { name: Crews.create }).click();
  await expect(page.getByRole("status").getByText(Crews.created)).toBeVisible();

  const row = crewRow(page, name);
  await expect(row).toContainText(Crews.active);
  await expect(row.locator('[dir="ltr"]')).toHaveText(
    `+964 ${phone.slice(1, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`,
  );
  await screenshot(page, "admin-crews");

  const crewPage = await logInElsewhere(browser, phone);
  await crewPage.waitForURL("**/crew");
  await crewPage.context().close();

  // The audit log shows it, filtered to crews.
  await page.goto("/admin/audit?entity=crews");
  const entry = page.getByRole("row").filter({ hasText: name }).first();
  await expect(entry).toContainText(Audit.actions.crew.create);
  await screenshot(page, "admin-audit");
});

test("a phone that already has a customer account can't become a crew", async ({ page }) => {
  const customer = await createCustomer();
  await logInAsAdmin(page);
  await page.goto("/admin/crews");
  await page.getByRole("button", { name: Crews.add }).click();
  const form = page.getByRole("form", { name: Crews.addTitle });
  await form.getByLabel(Crews.name).fill(`فريق ${customer.phone.slice(-5)}`);
  await form.getByLabel(Crews.phone).fill(customer.phone);
  await form.getByRole("button", { name: Crews.create }).click();
  await expect(form.getByText(editErrors.phone_has_account)).toBeVisible();

  const { data } = await admin
    .from("profiles")
    .select("role")
    .eq("phone", e164(customer.phone))
    .single()
    .throwOnError();
  expect(data.role).toBe("customer");
});

test("switching off a crew warns about its open orders and leaves them assigned", async ({
  page,
}) => {
  const crew = await createCrew();
  const customer = await createCustomer();
  const slot = await createSlot();
  try {
    const order = await createOrder(customer.phone, {
      slot,
      date: baghdadDate(3),
      status: "confirmed",
    });
    await admin.from("orders").update({ crew_id: crew.id }).eq("id", order.id).throwOnError();

    await logInAsAdmin(page);
    await page.goto("/admin/crews");
    const row = crewRow(page, crew.name);
    await expect(row.getByRole("link", { name: fill(Crews.openOrdersLink, crew) })).toHaveText("1");
    await row.getByRole("button", { name: fill(Crews.editLabel, crew) }).click();
    const form = page.getByRole("form", { name: fill(Crews.editLabel, crew) });
    await form.getByLabel(Crews.activeLabel).uncheck();
    await expect(form.getByText(/عند هذا الفريق طلب مفتوح واحد/)).toBeVisible();
    await screenshot(page, "admin-crew-off");
    await form.getByRole("button", { name: Crews.save }).click();
    await expect(page.getByText("انطفى الفريق. عنده طلب مفتوح يحتاج فريق ثاني.")).toBeVisible();
    await expect(row).toContainText(Crews.inactive);

    const { data } = await admin.from("orders").select("crew_id").eq("id", order.id).single();
    expect(data?.crew_id).toBe(crew.id);
  } finally {
    await disableSlot(slot.id);
  }
});

test("a crew moves to a new phone, which then logs in as the crew", async ({ page, browser }) => {
  const crew = await createCrew();
  await logInAsAdmin(page);
  await page.goto("/admin/crews");
  const row = crewRow(page, crew.name);
  await row.getByRole("button", { name: fill(Crews.editLabel, crew) }).click();
  const form = page.getByRole("form", { name: Crews.changePhone });
  const phone = newPhone();
  await form.getByLabel(Crews.newPhone).fill(phone);
  await form.getByRole("button", { name: Crews.savePhone }).click();
  await expect(page.getByRole("status").getByText(Crews.phoneSaved)).toBeVisible();

  const crewPage = await logInElsewhere(browser, phone);
  await crewPage.waitForURL("**/crew");
  await crewPage.context().close();
});

test("an existing customer becomes an admin, logs in to the dashboard, and is removed", async ({
  page,
  browser,
}) => {
  const customer = await createCustomer("زبون يصير مشرف");
  const me = await logInAsAdmin(page);
  await page.goto("/admin/admins");

  // Nobody removes themselves: the viewer's row has no remove button.
  const myRow = page.getByRole("row").filter({ hasText: Admins.you });
  await expect(myRow).toBeVisible();
  await expect(myRow.getByRole("button")).toHaveCount(0);

  await page.getByRole("button", { name: Admins.add }).click();
  const form = page.getByRole("form", { name: Admins.addTitle });
  await form.getByLabel(Admins.phone).fill(customer.phone);
  await form.getByLabel(Admins.name).fill("اسم ثاني");
  await form.getByRole("button", { name: Admins.create }).click();
  await expect(page.getByRole("status").getByText(Admins.added)).toBeVisible();
  // They keep their own name.
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: "زبون يصير مشرف" }) });
  await expect(row).toBeVisible();
  await screenshot(page, "admin-admins");

  const theirPage = await logInElsewhere(browser, customer.phone);
  await theirPage.waitForURL("**/admin");
  await theirPage.context().close();

  await row
    .getByRole("button", { name: fill(Admins.removeLabel, { name: "زبون يصير مشرف" }) })
    .click();
  await row.getByRole("button", { name: Admins.confirm }).click();
  await expect(page.getByRole("status").getByText(Admins.removed)).toBeVisible();
  await expect(row).toHaveCount(0);

  const { data } = await admin
    .from("admin_audit_log")
    .select("action")
    .eq("admin_id", me.id)
    .in("action", ["admin.add", "admin.remove"]);
  expect(data?.map((r) => r.action).sort()).toEqual(["admin.add", "admin.remove"]);
});
