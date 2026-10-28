import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCrew, createCustomer, createSubscription, logInAsAdmin } from "./helpers/admin";
import { enterCode, requestCode, screenshot, signUp } from "./helpers/auth";
import {
  baghdadDate,
  createOrder,
  createSlot,
  disableSlot,
  pickSlot,
  type TestSlot,
  userIdFor,
} from "./helpers/booking";
import { admin } from "./helpers/supabase";

// The annual subscription (Phase 6, task 2; one per address, settled Oct 28,
// 2026): N8 for guests and customers, the Profile card, Checkout's toggle,
// C4 without a cash tick, and A1, A7, A2 and A13 for admins. The plan's
// price comes from seed.sql (60,000 IQD) and no test changes it.

const { Subscription: N8, Checkout, Crew, Admin, UI } = messages;
const A7 = Admin.subscriptions;

let slot: TestSlot | null = null;
test.afterEach(async () => {
  if (slot) await disableSlot(slot.id);
  slot = null;
});

const card = (page: Page) => page.getByTestId("subscription-card").filter({ visible: true });

test("a guest sees the plan and goes through login to ask for it", async ({ page }) => {
  await page.goto("/subscription");
  await expect(page.getByRole("heading", { name: N8.title, level: 1 })).toBeVisible();
  const plan = page.getByTestId("subscription-plan");
  await expect(plan).toContainText("60,000 د.ع");
  await expect(plan).toContainText("زيارتين تنظيف وتعقيم بالسنة");
  await page.getByRole("link", { name: N8.request }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fsubscription/);
});

test("a customer asks for a subscription from Profile and sees it waiting", async ({ page }) => {
  await signUp(page);
  await page.goto("/profile");
  await expect(card(page)).toContainText(N8.card.noneBody);
  await card(page).click();
  await expect(page).toHaveURL(/\/subscription\?address=/);
  await expect(page.getByTestId("subscription-plan")).toBeVisible();
  await screenshot(page, "subscription-plan");

  await page.getByRole("button", { name: N8.request }).click();
  await expect(page.getByRole("heading", { name: N8.requestedTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: N8.request })).toHaveCount(0);

  await page.goto("/profile");
  await expect(card(page)).toContainText(N8.card.states.requested);
  await expect(card(page)).toContainText(N8.card.requestedBody);
});

test("Checkout uses a visit, and Profile shows the visit held", async ({ page }) => {
  slot = await createSlot();
  const phone = await signUp(page);
  await createSubscription(phone);

  await page.goto("/book");
  await pickSlot(page, baghdadDate(1), slot.label);
  await page.getByRole("link", { name: messages.Booking.next }).click();
  await expect(page).toHaveURL("/book/photos");
  await expect(page.getByRole("heading", { name: messages.Upload.title })).toBeVisible();
  await page.getByRole("link", { name: messages.Upload.next }).click();
  await expect(page).toHaveURL("/book/confirm");

  const toggle = page.getByRole("switch", { name: Checkout.subscription.title });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText("باقي لك 2 من 2 زيارات")).toBeVisible();
  await page.getByText(Checkout.subscription.title).click();
  await expect(toggle).toBeChecked();
  await expect(page.getByText(UI.covered)).toBeVisible();
  await screenshot(page, "checkout-subscription");
  await page.getByRole("button", { name: Checkout.confirm }).click();
  await page.waitForURL(/\/book\/done\//);

  const { data: order } = await admin
    .from("orders")
    .select("subscription_id, total_iqd")
    .eq("id", page.url().split("/").pop()!)
    .single()
    .throwOnError();
  expect(order.subscription_id).not.toBeNull();
  expect(order.total_iqd).toBe(35000);

  await page.goto("/profile");
  await expect(card(page)).toContainText(N8.card.states.active);
  await expect(card(page)).toContainText("1 من 2");
  await screenshot(page, "profile-subscription");

  await card(page).click();
  await expect(page.getByText(N8.nextBooked)).toBeVisible();
  await screenshot(page, "subscription-active");
});

test("Checkout explains why a two-tank booking isn't covered", async ({ page }) => {
  slot = await createSlot();
  const phone = await signUp(page);
  await createSubscription(phone, { tanks: 1 });
  await page.goto("/book");
  await page
    .getByRole("button", { name: messages.UI.increase })
    .filter({ visible: true })
    .first()
    .click();
  await pickSlot(page, baghdadDate(1), slot.label);
  await page.getByRole("link", { name: messages.Booking.next }).click();
  await expect(page).toHaveURL("/book/photos");
  await expect(page.getByRole("heading", { name: messages.Upload.title })).toBeVisible();
  await page.getByRole("link", { name: messages.Upload.next }).click();
  await expect(page).toHaveURL("/book/confirm");
  await expect(page.getByRole("switch", { name: Checkout.subscription.title })).toBeDisabled();
  await expect(page.getByText("اشتراكك يغطي خزان واحد بالزيارة.", { exact: false })).toBeVisible();
});

test("the crew finishes a covered job without a cash tick", async ({ page }) => {
  slot = await createSlot();
  const customer = await createCustomer("زبون الاشتراك");
  const subscription = await createSubscription(customer.phone);
  const crew = await createCrew();
  const order = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(0),
    status: "in_progress",
    crewId: crew.id,
    subscriptionId: subscription.id,
  });

  await requestCode(page, crew.phone);
  await enterCode(page, crew.phone);
  await page.waitForURL("**/crew");
  await page.goto(`/crew/jobs/${order.id}`);
  await page.getByRole("button", { name: Crew.steps.finish }).click();
  const sheet = page.getByRole("dialog", { name: Crew.finish.title });
  await expect(sheet.getByText(UI.covered)).toBeVisible();
  await expect(sheet.getByRole("checkbox")).toHaveCount(0);
  await sheet.getByLabel(Crew.finish.sterilant).fill("كلور");
  await sheet.getByRole("button", { name: Crew.finish.confirm }).click();
  await expect(sheet).toBeHidden();

  const { data } = await admin
    .from("subscription_overview")
    .select("visits_used, visits_left")
    .eq("id", subscription.id)
    .single()
    .throwOnError();
  expect(data).toMatchObject({ visits_used: 1, visits_left: 1 });
});

test.describe("admin", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("an admin activates a request from A1 through A7", async ({ page }) => {
    const customer = await createCustomer("زبون يريد اشتراك");
    const request = await createSubscription(customer.phone, { status: "requested" });
    await logInAsAdmin(page);

    await page
      .getByRole("list", { name: Admin.overview.subscriptionsCaption })
      .getByRole("link", { name: /زبون يريد اشتراك/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`subscription=${request.id}`));
    const drawer = page.getByRole("dialog");
    await expect(drawer).toContainText(A7.states.requested);
    await drawer.getByRole("button", { name: A7.drawer.activate }).click();
    await expect(drawer).toContainText(A7.states.active);
    await screenshot(page, "admin-subscription");

    await drawer.getByLabel(A7.drawer.adjustReason).fill("زيارة قبل التطبيق");
    await drawer.getByRole("button", { name: A7.drawer.addVisit }).click();
    await expect(drawer).toContainText("1 مستعملة · 0 محجوزة · 1 باقية من 2");

    const { data: log } = await admin
      .from("admin_audit_log")
      .select("action")
      .eq("entity_id", request.id)
      .order("id")
      .throwOnError();
    expect(log.map((row) => row.action)).toEqual(["subscription.activate", "subscription.adjust"]);
    const { data: notice } = await admin
      .from("notifications")
      .select("type")
      .eq("user_id", customer.id)
      .eq("type", "subscription_activated")
      .throwOnError();
    expect(notice).toHaveLength(1);
  });

  test("an admin declines a request with an internal reason", async ({ page }) => {
    const customer = await createCustomer("زبون مرفوض");
    const request = await createSubscription(customer.phone, { status: "requested" });
    await logInAsAdmin(page);
    await page.goto(`/admin/subscriptions?subscription=${request.id}`);
    const drawer = page.getByRole("dialog");
    await drawer.getByLabel(A7.drawer.reason).fill("رقم غلط");
    await drawer.getByRole("button", { name: A7.drawer.decline }).click();
    await expect(drawer).toContainText(A7.states.declined);
    await expect(drawer).toContainText("رقم غلط");
  });

  test("an admin drops an order's coverage in the A2 drawer", async ({ page }) => {
    slot = await createSlot();
    const customer = await createCustomer("زبون مشمول");
    const subscription = await createSubscription(customer.phone);
    const order = await createOrder(customer.phone, {
      slot,
      date: baghdadDate(2),
      subscriptionId: subscription.id,
    });
    await logInAsAdmin(page);
    await page.goto(`/admin/orders?order=${order.id}`);
    const drawer = page.getByRole("dialog");
    await expect(drawer).toContainText(Admin.drawer.subscription.covered);
    await drawer.getByRole("button", { name: Admin.drawer.subscription.drop }).click();
    await expect(drawer.getByRole("button", { name: Admin.drawer.subscription.use })).toBeVisible();
    await expect(drawer).toContainText("35,000 د.ع");
    const { data } = await admin
      .from("orders")
      .select("subscription_id")
      .eq("id", order.id)
      .single()
      .throwOnError();
    expect(data.subscription_id).toBeNull();
    expect(await userIdFor(customer.phone)).toBe(customer.id);
  });

  test("A13 shows the plan and saves it", async ({ page }) => {
    await logInAsAdmin(page);
    await page.goto("/admin/settings");
    const section = page.getByRole("form", { name: Admin.settings.subscription.title });
    await expect(section.getByLabel(Admin.settings.subscription.price)).toHaveValue("60000");
    await expect(section.getByLabel(Admin.settings.subscription.visits)).toHaveValue("2");
    await section.getByRole("button", { name: Admin.settings.save }).click();
    await expect(section.getByText(Admin.settings.saved)).toBeVisible();
  });
});
