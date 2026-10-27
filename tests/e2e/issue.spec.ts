import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCustomer } from "./helpers/admin";
import { enterCode, requestCode, screenshot } from "./helpers/auth";
import {
  baghdadDate,
  createCertificate,
  createOrder,
  createSlot,
  disableSlot,
  type TestSlot,
} from "./helpers/booking";
import { admin } from "./helpers/supabase";

// Issue report (spec §5.17) and My reports (N11): the customer reports a
// problem about an order with a photo, gets ZL-T-####, finds the message in
// Chat and the ticket in My reports with its status.

const { Issue, Reports, Profile, Report } = messages;

let slot: TestSlot | null = null;
test.beforeEach(async () => {
  slot = await createSlot();
});
test.afterEach(async () => {
  if (slot) await disableSlot(slot.id);
  slot = null;
});

const visible = (page: Page) => page.locator("main").filter({ visible: true });

async function logIn(page: Page, phone: string) {
  await requestCode(page, phone);
  await enterCode(page, phone);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("a customer reports a problem about an order with a photo, then finds it in Chat and My reports", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const customer = await createCustomer("زبونة البلاغ");
  const order = await createOrder(customer.phone, {
    slot: slot!,
    date: baghdadDate(0),
    status: "completed",
  });
  await createCertificate(order.id);
  await logIn(page, customer.phone);

  // From Report's "بلّغنا", which picks the order.
  await page.goto(`/orders/${order.id}/certificate`);
  await visible(page).getByRole("link", { name: Report.issue }).click();
  await page.waitForURL(`**/issue?order=${order.id}`);
  const main = visible(page);
  await expect(main.getByRole("heading", { level: 1, name: Issue.title })).toBeVisible();
  await expect(main.getByText("نرد عليك خلال ساعة بأوقات الدوام")).toBeVisible();
  await expect(main.getByLabel(Issue.order)).toHaveValue(order.id);
  await expect(main.getByLabel(Issue.order).locator("option")).toHaveText([
    new RegExp(`#${order.number}.* · ${Issue.today} · خزان سطح`),
    Issue.noOrder,
  ]);

  // Nothing picked: the category is asked for, then a longer description.
  await main.getByRole("button", { name: Issue.submit }).click();
  await expect(main.getByRole("alert")).toHaveText(Issue.errors.category);
  await main.getByRole("radio", { name: Issue.categories.smell }).check({ force: true });
  await main.getByLabel(Issue.description).fill("ريحة");
  await main.getByRole("button", { name: Issue.submit }).click();
  await expect(main.getByText("اكتب شوية أكثر، على الأقل 10 حروف.")).toBeVisible();

  await main.getByLabel(Issue.description).fill("بعد التنظيف بيوم صار الماي بيه ريحة كلور قوية");
  await main.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/tank.jpg");
  await expect(main.getByRole("img", { name: "صورة 1" })).toBeVisible();

  for (const control of [
    main.getByRole("link", { name: messages.UI.back }),
    main.getByRole("button", { name: Issue.addFileLabel }),
    main.getByRole("button", { name: Issue.submit }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await screenshot(page, "issue");

  await main.getByRole("button", { name: Issue.submit }).click();
  await expect(main.getByRole("heading", { name: Issue.sent })).toBeVisible();
  const { data: ticket } = await admin
    .from("tickets")
    .select("id, number, category, order_id, source, ticket_media(media_type)")
    .eq("user_id", customer.id)
    .single()
    .throwOnError();
  expect(ticket).toMatchObject({
    category: "smell",
    order_id: order.id,
    source: "app",
    ticket_media: [{ media_type: "photo" }],
  });
  await expect(main.getByText(`ZL-T-${ticket.number}`)).toBeVisible();
  await screenshot(page, "issue-sent");

  // The Issue report's own chat wording.
  await main.getByRole("link", { name: Issue.openChat }).click();
  await page.waitForURL("**/chat");
  await expect(
    visible(page).getByText(`وصلنا بلاغك ZL-T-${ticket.number} عن طلب #${order.number}`),
  ).toBeVisible();

  // My reports, from Profile.
  await page.goto("/profile");
  await visible(page)
    .getByRole("link", { name: new RegExp(Profile.reports) })
    .click();
  await page.waitForURL("**/reports");
  const list = visible(page);
  const card = list.getByRole("listitem").filter({ hasText: `ZL-T-${ticket.number}` });
  await expect(card).toContainText(Issue.categories.smell);
  await expect(card).toContainText(Reports.status.open);
  await card.getByRole("link").click();
  await page.waitForURL(`**/reports/${ticket.id}`);
  await expect(visible(page).getByText("بعد التنظيف بيوم صار الماي")).toBeVisible();
  await expect(visible(page).getByRole("button", { name: /صورة 1/ })).toBeVisible();

  // Support takes it in hand: the status follows live.
  await admin.from("tickets").update({ status: "in_progress" }).eq("id", ticket.id).throwOnError();
  await expect(visible(page).getByText(Reports.status.in_progress)).toBeVisible();
  await screenshot(page, "report-detail");
});

test("My reports is empty with a way to report, and the Issue report works without an order", async ({
  page,
}) => {
  const customer = await createCustomer();
  await logIn(page, customer.phone);
  await page.goto("/reports");
  const main = visible(page);
  await expect(main.getByRole("heading", { name: Reports.empty })).toBeVisible();
  await main.getByRole("link", { name: Reports.new }).last().click();
  await page.waitForURL("**/issue");

  const form = visible(page);
  await expect(form.getByLabel(Issue.order)).toHaveValue("");
  await form.getByRole("radio", { name: Issue.categories.payment }).check({ force: true });
  await form.getByLabel(Issue.description).fill("دفعت كاش وما انطوني وصل");
  await form.getByRole("button", { name: Issue.submit }).click();
  await expect(form.getByRole("heading", { name: Issue.sent })).toBeVisible();

  // Without a reload (Next keeps visited pages alive): Home, Profile, My
  // reports, then a second report starts from an empty form.
  await form.getByRole("link", { name: Issue.home }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await visible(page).getByRole("link", { name: messages.UI.tabs.profile }).click();
  await page.waitForURL("**/profile");
  await visible(page)
    .getByRole("link", { name: new RegExp(Profile.reports) })
    .click();
  await page.waitForURL("**/reports");
  await expect(visible(page).getByText(Issue.categories.payment)).toBeVisible();
  await expect(visible(page).getByText(Reports.noOrder)).toBeVisible();
  await visible(page).getByRole("link", { name: Reports.new }).first().click();
  await page.waitForURL("**/issue");
  await expect(visible(page).getByRole("button", { name: Issue.submit })).toBeVisible();
  await expect(visible(page).getByLabel(Issue.description)).toHaveValue("");
});
