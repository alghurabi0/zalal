import { readFile } from "node:fs/promises";

import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCustomer, logInAsAdmin, logInAsCrew } from "./helpers/admin";
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

// Certificates and rating (spec §5.15, N15, §6, §10.1): the crew's finish
// issues the certificate and its PDF; the customer reads Report, downloads
// the PDF, shares the public page and rates the company; 3 stars or fewer
// opens a ticket.

const { Report, PublicCertificate, Crew, Orders, Order, Admin } = messages;

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

/** A customer and a completed order with a certificate (no PDF yet). */
async function completedOrder() {
  const customer = await createCustomer("زبونة الشهادة");
  const order = await createOrder(customer.phone, {
    slot: slot!,
    date: baghdadDate(0),
    status: "completed",
  });
  const certificate = await createCertificate(order.id, { chlorine: 0.4 });
  return { customer, order, certificate };
}

test("the crew's finish issues the certificate; the customer reads it, downloads the PDF and shares N15", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const customer = await createCustomer("زبونة الشهادة");

  // The crew finishes the job on its own phone.
  const crewContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const crewPage = await crewContext.newPage();
  const crew = await logInAsCrew(crewPage);
  const order = await createOrder(customer.phone, {
    slot: slot!,
    date: baghdadDate(0),
    status: "in_progress",
    crewId: crew.id,
  });
  await crewPage.goto(`/crew/jobs/${order.id}`);
  await crewPage.getByRole("button", { name: Crew.steps.finish }).click();
  const sheet = crewPage.getByRole("dialog", { name: Crew.finish.title });
  await sheet.getByLabel(Crew.finish.sterilant).fill("كلور 50 ملغ/لتر · ساعة");
  await sheet.getByLabel(Crew.finish.chlorine).fill("0.4");
  await sheet.getByRole("checkbox").check();
  await sheet.getByRole("button", { name: Crew.finish.confirm }).click();
  await expect(crewPage.getByText(Crew.job.closed)).toBeVisible();
  await crewContext.close();

  // Issued with the move, and its PDF made right after (after()).
  const { data: certificate } = await admin
    .from("certificates")
    .select("id, public_code, sterilant, residual_chlorine_mg_l")
    .eq("order_id", order.id)
    .single()
    .throwOnError();
  expect(certificate).toMatchObject({
    sterilant: "كلور 50 ملغ/لتر · ساعة",
    residual_chlorine_mg_l: 0.4,
  });
  await expect
    .poll(
      async () =>
        (await admin.from("certificates").select("pdf_path").eq("id", certificate.id).single()).data
          ?.pdf_path ?? null,
      { timeout: 60_000 },
    )
    .toMatch(new RegExp(`^${certificate.id}/\\d+\\.pdf$`));

  // Orders' button opens Report.
  await logIn(page, customer.phone);
  await page.goto("/orders?tab=past");
  const button = visible(page).getByRole("link", { name: Orders.certificate });
  await expect(button).toHaveAttribute("href", `/orders/${order.id}/certificate`);
  await button.click();
  await page.waitForURL(`**/orders/${order.id}/certificate`);

  const main = visible(page);
  await expect(main.getByRole("heading", { name: Report.title, level: 1 })).toBeVisible();
  await expect(main).toContainText(Report.headline);
  await expect(main).toContainText(`ZL-${order.number}`);
  const rows = main.getByRole("region", { name: Report.rows.label });
  await expect(rows).toContainText("كلور 50 ملغ/لتر · ساعة");
  await expect(rows).toContainText("0.4 ملغ/لتر");
  await expect(rows).toContainText(Report.company);
  // No crew photos on this job.
  await expect(main.getByText(Report.noPhotos)).toHaveCount(2);
  for (const control of [
    main.getByRole("link", { name: Report.download }),
    main.getByRole("radio", { name: "1 من 5" }),
    page.getByRole("button", { name: Report.share }),
  ]) {
    const box = await control
      .locator("xpath=ancestor-or-self::*[self::a or self::label or self::button][1]")
      .boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await screenshot(page, "report");

  // The stored PDF downloads as ZL-<number>.pdf: one A4 page.
  const downloading = page.waitForEvent("download");
  await main.getByRole("link", { name: Report.download }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`ZL-${order.number}.pdf`);
  const pdf = await readFile(await download.path());
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)).toHaveLength(1);

  // مشاركة: no share sheet in this browser, so the link is copied.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
  await page.getByRole("button", { name: Report.share }).click();
  await expect(page.getByRole("status").filter({ hasText: Report.copied })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toBe(new URL(`/c/${certificate.public_code}`, page.url()).toString());

  // N15 opens without login and shows nothing personal.
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const publicPage = await guest.newPage();
  await publicPage.goto(`/c/${certificate.public_code.toLowerCase()}`);
  const publicMain = visible(publicPage);
  await expect(publicMain).toContainText(PublicCertificate.valid);
  await expect(publicMain).toContainText(`ZL-${order.number}`);
  await expect(publicMain).toContainText(customer.district);
  await expect(publicMain).not.toContainText("زبونة الشهادة");
  await expect(publicMain).not.toContainText(customer.phone);
  await expect(publicMain).not.toContainText(customer.phone.slice(1));
  await screenshot(publicPage, "public-certificate");
  await publicPage.goto("/c/ZZZZZZZZ");
  await expect(visible(publicPage)).toContainText(PublicCertificate.notFound);
  await guest.close();
});

test("3 stars or fewer opens a ticket; a rating is sent once and then read-only", async ({
  page,
  browser,
}) => {
  const { customer, order: low } = await completedOrder();
  const high = await createOrder(customer.phone, {
    slot: slot!,
    date: baghdadDate(0),
    status: "completed",
  });
  await createCertificate(high.id);
  await logIn(page, customer.phone);

  await page.goto(`/orders/${low.id}/certificate`);
  const main = visible(page);
  const send = page.getByRole("button", { name: Report.rating.send });
  await expect(send).toBeDisabled();
  await main.getByRole("radio", { name: "2 من 5" }).check({ force: true });
  await main.getByRole("checkbox", { name: Report.rating.tags.clean_work }).check({ force: true });
  await main.getByLabel(Report.rating.comment).fill("تأخروا ساعة");
  await send.click();
  await expect(main.getByRole("status")).toContainText(Report.rating.thanks);

  const { data: rating } = await admin
    .from("ratings")
    .select("stars, tags, comment, tickets(number, source, status, user_id)")
    .eq("order_id", low.id)
    .single()
    .throwOnError();
  expect(rating).toMatchObject({
    stars: 2,
    tags: ["clean_work"],
    comment: "تأخروا ساعة",
    tickets: { source: "rating", status: "open", user_id: customer.id },
  });
  const ticket = `ZL-T-${rating.tickets!.number}`;
  await expect(main.getByRole("status")).toContainText(ticket);

  // Read-only after a reload: no send button, the picked tag and comment shown.
  await page.reload();
  await expect(page.getByRole("button", { name: Report.rating.send })).toHaveCount(0);
  await expect(main.getByRole("radio", { name: "2 من 5" })).toBeChecked();
  await expect(main.getByRole("radio", { name: "2 من 5" })).toBeDisabled();
  await expect(main.getByRole("list", { name: Report.rating.tagsLegend })).toHaveText(
    Report.rating.tags.clean_work,
  );
  await expect(main).toContainText("تأخروا ساعة");
  await screenshot(page, "report-rated");

  // 5 stars opens no ticket.
  await page.goto(`/orders/${high.id}/certificate`);
  await visible(page).getByRole("radio", { name: "5 من 5" }).check({ force: true });
  await page.getByRole("button", { name: Report.rating.send }).click();
  await expect(visible(page).getByRole("status")).toContainText(Report.rating.thanks);
  const { data: highRating } = await admin
    .from("ratings")
    .select("stars, ticket_id")
    .eq("order_id", high.id)
    .single()
    .throwOnError();
  expect(highRating).toEqual({ stars: 5, ticket_id: null });

  // Admins see the ticket on A1 and the rating in the order drawer.
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const adminPage = await adminContext.newPage();
  await logInAsAdmin(adminPage);
  const row = adminPage
    .getByRole("list", { name: Admin.overview.ticketsCaption })
    .getByRole("link", {
      name: new RegExp(`${ticket}.*#${low.number}`),
    });
  await expect(row).toBeVisible();
  await row.click();
  const drawer = adminPage.getByRole("dialog");
  await expect(drawer).toContainText(Admin.drawer.certificate);
  await expect(drawer).toContainText("تأخروا ساعة");
  await expect(drawer).toContainText(ticket);
  await adminContext.close();
});

test("links to the certificate, and who may open it", async ({ page, browser }) => {
  const { customer, order, certificate } = await completedOrder();
  await logIn(page, customer.phone);

  // Order details: الشهادة and the job's files.
  await page.goto(`/orders/${order.id}`);
  await expect(visible(page).getByRole("link", { name: Order.certificateButton })).toHaveAttribute(
    "href",
    `/orders/${order.id}/certificate`,
  );
  await expect(visible(page).getByRole("link", { name: Order.jobMedia })).toHaveAttribute(
    "href",
    `/orders/${order.id}/live`,
  );

  // The customer may open the print page; a guest and another customer get
  // the not-found page (streamed, so the status is already sent as 200).
  await page.goto(`/certificates/${certificate.id}/print`);
  await expect(page.locator("[data-certificate]")).toContainText(`ZL-${order.number}`);
  await expect(page.locator("[data-certificate]")).toContainText("زبونة الشهادة");

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  const refused = async () => {
    await guestPage.goto(`/certificates/${certificate.id}/print`);
    await expect(guestPage.getByText("404", { exact: true })).toBeVisible();
    await expect(guestPage.locator("[data-certificate]")).toHaveCount(0);
    await expect(guestPage.locator("body")).not.toContainText("زبونة الشهادة");
  };
  await refused();
  const other = await createCustomer("زبون ثاني");
  await logIn(guestPage, other.phone);
  await refused();
  // Another customer's download goes back to Report, which has nothing to show.
  await guestPage.goto(`/orders/${order.id}/certificate/pdf`);
  await guestPage.waitForURL(`**/orders/${order.id}/certificate`);
  await expect(visible(guestPage)).toContainText(Report.notReady);
  await guest.close();

  // An order moved out of completed: Report sends the customer on, N15 shows nothing.
  await admin.from("orders").update({ status: "in_progress" }).eq("id", order.id).throwOnError();
  await page.goto(`/orders/${order.id}/certificate`);
  await page.waitForURL(`**/orders/${order.id}/live`);
  await page.goto(`/c/${certificate.public_code}`);
  await expect(visible(page)).toContainText(PublicCertificate.notFound);
});
