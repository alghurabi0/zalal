import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCustomer, logInAsAdmin } from "./helpers/admin";
import { screenshot } from "./helpers/auth";
import {
  baghdadDate,
  createOrder,
  createSlot,
  disableSlot,
  type TestSlot,
} from "./helpers/booking";
import { admin } from "./helpers/supabase";

// A5 tickets and A12 ratings (spec §8.2): the admin finds a customer's
// report, takes it in hand, closes it, keeps an internal note and jumps to
// the chat; ratings filter by stars and link to the ticket they opened.

test.use({ viewport: { width: 1280, height: 800 } });

const { Admin, Issue } = messages;
const A5 = Admin.tickets;

let slot: TestSlot | null = null;
test.beforeEach(async () => {
  slot = await createSlot();
});
test.afterEach(async () => {
  if (slot) await disableSlot(slot.id);
  slot = null;
});

const main = (page: Page) => page.getByRole("main");

test("an admin works a ticket in A5: status, internal note, audit and the jump to chat", async ({
  page,
}) => {
  const customer = await createCustomer("زبون البلاغ");
  const order = await createOrder(customer.phone, {
    slot: slot!,
    date: baghdadDate(0),
    status: "completed",
  });
  const { data: ticket } = await admin
    .from("tickets")
    .insert({
      user_id: customer.id,
      order_id: order.id,
      source: "app",
      category: "leak",
      description: "تسريب من الغطاء بعد التنظيف بيوم",
    })
    .select("id, number")
    .single()
    .throwOnError();
  const label = `ZL-T-${ticket.number}`;

  await logInAsAdmin(page);
  await page.getByRole("navigation").getByRole("link", { name: Admin.nav.tickets }).click();
  await page.waitForURL("**/admin/tickets");

  // Search by the customer's phone digits.
  await main(page).getByLabel(A5.search).fill(customer.phone.slice(-7));
  await main(page).getByRole("button", { name: A5.apply }).click();
  await page.waitForURL(/q=/);
  const row = main(page).getByRole("row").filter({ hasText: label });
  await expect(row).toContainText(Issue.categories.leak);
  await expect(row).toContainText(A5.statuses.open);
  await row.getByRole("link", { name: label }).click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText("تسريب من الغطاء بعد التنظيف بيوم");
  await expect(drawer.getByRole("link", { name: new RegExp(`#${order.number}`) })).toHaveAttribute(
    "href",
    `/admin/orders?order=${order.id}`,
  );

  await drawer.getByRole("button", { name: A5.statuses.in_progress }).click();
  await expect(drawer.getByRole("button", { name: A5.statuses.in_progress })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await drawer.getByLabel(A5.drawer.noteLabel).fill("اتصلنا بيه، الفريق يرجع باجر");
  await drawer.getByRole("button", { name: A5.drawer.addNote }).click();
  await expect(drawer.getByText("اتصلنا بيه، الفريق يرجع باجر")).toBeVisible();
  await drawer.getByRole("button", { name: A5.statuses.closed }).click();
  await expect(drawer.getByRole("button", { name: A5.statuses.closed })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await screenshot(page, "admin-ticket");

  const { data: saved } = await admin
    .from("tickets")
    .select("status, ticket_notes(note)")
    .eq("id", ticket.id)
    .single()
    .throwOnError();
  expect(saved).toEqual({
    status: "closed",
    ticket_notes: [{ note: "اتصلنا بيه، الفريق يرجع باجر" }],
  });
  const { data: log } = await admin
    .from("admin_audit_log")
    .select("action")
    .eq("entity_id", ticket.id)
    .order("id")
    .throwOnError();
  expect(log.map((entry) => entry.action)).toEqual([
    "ticket.status",
    "ticket.note",
    "ticket.status",
  ]);

  // The customer's chat, where the ticket message already is.
  await drawer.getByRole("link", { name: A5.drawer.chat }).click();
  await page.waitForURL(/\/admin\/chat\/[0-9a-f-]{36}/);
  await expect(main(page).getByText(`وصلنا بلاغك ${label}`)).toBeVisible();
});

test("A12 lists ratings with a star filter and links a low rating to its ticket", async ({
  page,
}) => {
  const customer = await createCustomer("زبونة التقييم");
  const low = await createOrder(customer.phone, {
    slot: slot!,
    date: baghdadDate(0),
    status: "completed",
  });
  const high = await createOrder(customer.phone, {
    slot: slot!,
    date: baghdadDate(0),
    status: "completed",
  });
  const { data: ticket } = await admin
    .from("tickets")
    .insert({ user_id: customer.id, order_id: low.id, source: "rating" })
    .select("id, number")
    .single()
    .throwOnError();
  await admin
    .from("ratings")
    .insert([
      { order_id: low.id, stars: 2, tags: [], comment: "الفريق تأخر كلش", ticket_id: ticket.id },
      { order_id: high.id, stars: 5, tags: ["on_time", "clean_work"] },
    ])
    .throwOnError();

  await logInAsAdmin(page);
  await page.goto("/admin/ratings");
  await expect(main(page).getByText(Admin.ratings.average)).toBeVisible();
  await expect(main(page).getByText(/\d\.\d من 5/)).toBeVisible();

  await main(page)
    .getByRole("navigation", { name: Admin.ratings.filter })
    .getByRole("link", { name: /^2 ★/ })
    .click();
  await page.waitForURL("**/admin/ratings?stars=2");
  const lowRow = main(page)
    .getByRole("row")
    .filter({ hasText: `#${low.number}` });
  await expect(lowRow).toContainText("الفريق تأخر كلش");
  await expect(
    main(page)
      .getByRole("row")
      .filter({ hasText: `#${high.number}` }),
  ).toHaveCount(0);
  await screenshot(page, "admin-ratings");

  await lowRow.getByRole("link", { name: `ZL-T-${ticket.number}` }).click();
  await page.waitForURL(`**/admin/tickets?ticket=${ticket.id}`);
  await expect(page.getByRole("dialog")).toContainText(
    Admin.tickets.drawer.stars.replace("{n}", "2"),
  );
});

test("A13 previews the Issue report's promised response time", async ({ page }) => {
  await logInAsAdmin(page);
  await page.goto("/admin/settings");
  const form = page.getByRole("form", { name: Admin.settings.chat.title });
  const field = form.getByLabel(Admin.settings.chat.ticketHours);
  await field.fill("2");
  await expect(form.getByText("«نرد عليك خلال ساعتين بأوقات الدوام»")).toBeVisible();
  await field.fill("0");
  await expect(field).toHaveAttribute("aria-invalid", "true");
});
