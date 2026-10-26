import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCrew, createCustomer, logInAsCrew } from "./helpers/admin";
import { e164, enterCode, requestCode, screenshot } from "./helpers/auth";
import { baghdadDate, createOrder, createSlot } from "./helpers/booking";
import { admin } from "./helpers/supabase";

// The crew app, part A (spec §8.1 C1–C3a): My jobs, Job detail and the
// status button. Photos are optional (settled Oct 26, 2026).

const { Crew } = messages;

function jobCard(page: Page, number: number) {
  return page
    .getByRole("link")
    .filter({ hasText: `#${number}` })
    .filter({ visible: true });
}

async function statusOf(id: string) {
  const { data } = await admin.from("orders").select("status").eq("id", id).single().throwOnError();
  return data.status;
}

test("My jobs lists the crew's jobs for today and tomorrow, and no one else's", async ({
  page,
}) => {
  const slot = await createSlot();
  const customer = await createCustomer();
  const crew = await logInAsCrew(page);
  const other = await createCrew();

  const today = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(0),
    status: "confirmed",
    crewId: crew.id,
    note: "الباب الأزرق",
  });
  const tomorrow = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(1),
    status: "confirmed",
    crewId: crew.id,
  });
  const pending = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(0),
    crewId: crew.id,
  });
  const notOurs = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(0),
    status: "confirmed",
    crewId: other.id,
  });

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(Crew.title);
  await expect(jobCard(page, today.number)).toContainText(customer.district);
  await expect(jobCard(page, today.number)).toContainText("الباب الأزرق");
  await expect(jobCard(page, today.number)).toContainText(Crew.status.confirmed);
  await expect(jobCard(page, tomorrow.number)).toBeVisible();
  await expect(page.getByText(slot.label).first()).toBeVisible();
  // Waiting for confirmation, or another crew's: not listed.
  await expect(jobCard(page, pending.number)).toHaveCount(0);
  await expect(jobCard(page, notOurs.number)).toHaveCount(0);
  await screenshot(page, "crew-jobs");

  // A job assigned while the page is open appears by itself (Realtime).
  const later = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(1),
    status: "confirmed",
  });
  await admin.from("orders").update({ crew_id: crew.id }).eq("id", later.id).throwOnError();
  await expect(jobCard(page, later.number)).toBeVisible({ timeout: 15_000 });
});

test("a crew runs a job from confirmed to completed without photos", async ({ page }) => {
  const slot = await createSlot();
  const customer = await createCustomer("زبون الشغل");
  const crew = await logInAsCrew(page);
  const order = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(0),
    status: "confirmed",
    crewId: crew.id,
  });

  await page.reload();
  await jobCard(page, order.number).click();
  await page.waitForURL(`**/crew/jobs/${order.id}`);

  const call = page.getByRole("link", {
    name: Crew.job.callNamed.replace("{name}", "زبون الشغل"),
  });
  await expect(call).toHaveAttribute("href", `tel:${e164(customer.phone)}`);
  await expect(page.getByRole("link", { name: Crew.job.openMaps })).toHaveAttribute(
    "href",
    /google\.com\/maps\/dir\/\?api=1&destination=32\.616,44\.024/,
  );
  await screenshot(page, "crew-job");

  const badge = page.getByRole("heading", { level: 1 }).locator("..");
  for (const [step, status] of [
    [Crew.steps.leave, Crew.status.on_the_way],
    [Crew.steps.arrive, Crew.status.arrived],
    [Crew.steps.start, Crew.status.in_progress],
  ] as const) {
    await page.getByRole("button", { name: step }).click();
    await expect(badge).toContainText(status);
  }
  // Work started: no more no-show.
  await expect(page.getByRole("button", { name: Crew.noShow.open })).toHaveCount(0);

  await page.getByRole("button", { name: Crew.steps.finish }).click();
  const sheet = page.getByRole("dialog", { name: Crew.finish.title });
  const confirm = sheet.getByRole("button", { name: Crew.finish.confirm });
  await expect(confirm).toBeDisabled();
  await sheet.getByRole("checkbox").check();
  await expect(sheet).toContainText("35,000");
  await confirm.click();
  await expect(sheet).toBeHidden();
  await expect(badge).toContainText(Crew.status.completed);
  await expect(page.getByText(Crew.job.closed)).toBeVisible();
  // The job is closed: the customer's phone is no longer shown.
  await expect(call).toHaveCount(0);
  expect(await statusOf(order.id)).toBe("completed");

  const timeline = page.getByRole("list").filter({ hasText: Crew.events.completed });
  await expect(timeline).toContainText(Crew.events.on_the_way);
});

test("a no-show needs a note, which stays internal", async ({ page }) => {
  const slot = await createSlot();
  const customer = await createCustomer();
  const crew = await logInAsCrew(page);
  const order = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(0),
    status: "confirmed",
    crewId: crew.id,
  });

  await page.goto(`/crew/jobs/${order.id}`);
  await page.getByRole("button", { name: Crew.noShow.open }).click();
  const sheet = page.getByRole("dialog", { name: Crew.noShow.title });
  await sheet.getByRole("button", { name: Crew.noShow.confirm }).click();
  await expect(sheet.getByText(Crew.errors.reason_required, { exact: true })).toBeVisible();

  await sheet.getByLabel(Crew.noShow.label).fill("دقينا الباب نص ساعة");
  await sheet.getByRole("button", { name: Crew.noShow.confirm }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText(
    Crew.status.no_show,
  );
  await expect(page.getByText("دقينا الباب نص ساعة")).toBeVisible();
  expect(await statusOf(order.id)).toBe("no_show");
});

test("another crew's job reads as not found, and a crew with no jobs sees the empty state", async ({
  page,
  browser,
}) => {
  const slot = await createSlot();
  const customer = await createCustomer();
  const owner = await createCrew();
  const order = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(0),
    status: "confirmed",
    crewId: owner.id,
  });

  await logInAsCrew(page);
  await expect(page.getByRole("heading", { name: Crew.emptyTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: Crew.refresh })).toBeVisible();

  await page.goto(`/crew/jobs/${order.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(Crew.job.notFound);

  // A job taken away while open: the next move says so.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ownerPage = await context.newPage();
  await requestCode(ownerPage, owner.phone);
  await enterCode(ownerPage, owner.phone);
  await ownerPage.waitForURL("**/crew");
  await ownerPage.goto(`/crew/jobs/${order.id}`);
  await admin.from("orders").update({ crew_id: null }).eq("id", order.id).throwOnError();
  await ownerPage.getByRole("button", { name: Crew.steps.leave }).click();
  await expect(ownerPage.getByRole("heading", { level: 1 })).toHaveText(Crew.job.notFound);
  await context.close();
});
