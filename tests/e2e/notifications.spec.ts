import { randomUUID } from "node:crypto";

import { devices, expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };
import { createCustomer, createCrew, logInAsAdmin, logInAsCrew } from "./helpers/admin";
import { enterCode, requestCode, screenshot, signUp } from "./helpers/auth";
import { baghdadDate, createOrder, createSlot, userIdFor } from "./helpers/booking";
import { stubPush } from "./helpers/push";
import { admin } from "./helpers/supabase";

// Notifications (spec §5.7, §9.2): the list grouped اليوم / قبل with unread
// items on white, tapping one marks it read and opens its target, قراءة الكل,
// the Home bell's dot, live arrivals; the soft push card on Booking success
// (N5) on Android and iPhone; logout forgetting the browser; staff push
// buttons and push taps for staff.

const { Notifications, Profile } = messages;
const t = Notifications.items;

type NotificationRow = {
  type: string;
  data?: Record<string, unknown>;
  order_id?: string | null;
  created_at?: string;
  read_at?: string | null;
};

async function addNotifications(userId: string, rows: NotificationRow[]) {
  const { data } = await admin
    .from("notifications")
    .insert(rows.map((row) => ({ user_id: userId, data: {}, ...row })) as never)
    .select("id, type")
    .throwOnError();
  return data!;
}

async function clearNotifications(userId: string) {
  await admin.from("notifications").delete().eq("user_id", userId).throwOnError();
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

/** A logged-in customer (on Home) with one on-the-way order and no notifications. */
async function customerWithOrder(page: Page) {
  const phone = await signUp(page);
  const userId = await userIdFor(phone);
  const slot = await createSlot();
  const crew = await createCrew();
  const order = await createOrder(phone, {
    slot,
    date: baghdadDate(0),
    status: "on_the_way",
    crewId: crew.id,
  });
  // The fixture's own events wrote notifications; start from none.
  await clearNotifications(userId);
  return { phone, userId, order };
}

test("the list groups today and before, opens items and marks them read", async ({ page }) => {
  const { userId, order } = await customerWithOrder(page);
  const orderValues = {
    number: order.number,
    service_date: baghdadDate(0),
    slot_start_at: hoursAgo(1),
    slot_end_at: hoursAgo(-1),
    district: "حي الحسين",
  };
  await addNotifications(userId, [
    { type: "crew_on_the_way", data: orderValues, order_id: order.id, created_at: hoursAgo(0.1) },
    {
      type: "support_message",
      data: { excerpt: "تم تأكيد تغيير الموعد" },
      created_at: hoursAgo(0.05),
    },
    {
      type: "order_completed",
      data: orderValues,
      order_id: order.id,
      created_at: hoursAgo(26),
      read_at: hoursAgo(25),
    },
    {
      type: "cleaning_reminder",
      data: { kind: "due", due_on: baghdadDate(-15), months: 6, label: "home" },
      created_at: hoursAgo(24 * 15),
      read_at: hoursAgo(24 * 14),
    },
  ]);

  // Home's bell shows the dot and opens the list.
  await page.goto("/");
  const bell = page.getByRole("link", { name: Notifications.bellUnread });
  await expect(bell).toBeVisible();
  await screenshot(page, "home-bell");
  await bell.click();
  await page.waitForURL("**/notifications");

  await expect(page.getByRole("heading", { name: Notifications.title, level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const today = page.getByRole("region", { name: Notifications.today });
  const earlier = page.getByRole("region", { name: Notifications.earlier });
  await expect(today.getByRole("listitem")).toHaveCount(2);
  await expect(earlier.getByRole("listitem")).toHaveCount(2);
  await expect(today.getByText(t.crew_on_the_way.title)).toBeVisible();
  await expect(today.getByText(`طلب #${order.number} · تابعهم على الخريطة.`)).toBeVisible();
  await expect(today.getByText(Notifications.unread)).toHaveCount(2);
  await expect(earlier.getByText(Notifications.yesterday)).toBeVisible();
  await expect(earlier.getByText("مرت 6 أشهر على آخر تنظيف لخزان البيت.")).toBeVisible();
  await expect(earlier.getByText(Notifications.unread)).toHaveCount(0);

  for (const control of [
    page.getByRole("link", { name: messages.UI.back }),
    page.getByRole("button", { name: Notifications.readAll }),
  ]) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  await screenshot(page, "notifications");

  // A new notification arrives while the list is open.
  await addNotifications(userId, [{ type: "support_message", data: { excerpt: "وصل الفريق؟" } }]);
  await expect(today.getByText("وصل الفريق؟")).toBeVisible();

  // Tapping an item marks it read and opens its target.
  await today.getByRole("link", { name: /تم تأكيد تغيير الموعد/ }).click();
  await page.waitForURL("**/chat");
  const { data: opened } = await admin
    .from("notifications")
    .select("read_at")
    .eq("user_id", userId)
    .eq("data->>excerpt", "تم تأكيد تغيير الموعد")
    .single()
    .throwOnError();
  expect(opened.read_at).not.toBeNull();

  // قراءة الكل marks the rest; the button and the dots go.
  await page.goto("/notifications");
  await page.getByRole("button", { name: Notifications.readAll }).click();
  await expect(page.getByRole("button", { name: Notifications.readAll })).toHaveCount(0);
  await expect(page.getByText(Notifications.unread)).toHaveCount(0);
  const { count } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  expect(count).toBe(0);

  await page.goto("/");
  await expect(page.getByRole("link", { name: Notifications.bell, exact: true })).toBeVisible();
});

test("an empty list offers a booking", async ({ page }) => {
  await signUp(page);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: Notifications.empty })).toBeVisible();
  await expect(page.getByRole("link", { name: Notifications.emptyAction })).toHaveAttribute(
    "href",
    "/book",
  );
  await expect(page.getByRole("button", { name: Notifications.readAll })).toHaveCount(0);
});

test("someone else's notification opens the viewer's own list", async ({ page }) => {
  const other = await createCustomer();
  const [row] = await addNotifications(other.id, [
    { type: "support_message", data: { excerpt: "سر" } },
  ]);
  await signUp(page);
  await page.goto(`/notifications/${row!.id}`);
  await page.waitForURL("**/notifications");
  const { data } = await admin.from("notifications").select("read_at").eq("id", row!.id).single();
  expect(data!.read_at).toBeNull();
});

test("Booking success offers push; logout forgets this browser", async ({ page }) => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${randomUUID()}`;
  await stubPush(page, endpoint);
  const { phone, userId } = await customerWithOrder(page);
  const slot = await createSlot();
  const booked = await createOrder(phone, { slot, date: baghdadDate(2) });

  await page.goto(`/book/done/${booked.id}`);
  const card = page.getByRole("region", { name: Notifications.push.title });
  await expect(card).toBeVisible();
  await expect(card.getByText(Notifications.push.body)).toBeVisible();
  await screenshot(page, "booking-done-push");

  await card.getByRole("button", { name: Notifications.push.enable }).click();
  await expect(card.getByText(Notifications.push.enabled)).toBeVisible();
  const saved = await admin.from("push_subscriptions").select("user_id").eq("endpoint", endpoint);
  expect(saved.data).toEqual([{ user_id: userId }]);

  // Already on: a later booking doesn't ask again.
  await page.reload();
  await expect(page.getByRole("heading", { name: `وصلنا طلبك #${booked.number}` })).toBeVisible();
  await expect(page.getByRole("region", { name: Notifications.push.title })).toHaveCount(0);

  // Logout deletes the subscription, so the next person on this phone gets none of it.
  await page.goto("/profile");
  await page.getByRole("button", { name: Profile.logout }).click();
  await page.getByRole("button", { name: Profile.logoutConfirm }).click();
  await page.waitForURL("**/welcome");
  const left = await admin.from("push_subscriptions").select("id").eq("endpoint", endpoint);
  expect(left.data).toEqual([]);
});

test.describe("on an iPhone in Safari", () => {
  test.use({ userAgent: devices["iPhone 15"].userAgent });

  test("the card explains adding the app to the home screen first, and بعدين hides it", async ({
    page,
  }) => {
    const { phone } = await customerWithOrder(page);
    const slot = await createSlot();
    const booked = await createOrder(phone, { slot, date: baghdadDate(2) });

    await page.goto(`/book/done/${booked.id}`);
    const card = page.getByRole("region", { name: Notifications.push.iosTitle });
    await expect(card).toBeVisible();
    await expect(card.getByText(Notifications.push.iosAdd)).toBeVisible();
    await expect(card.getByRole("button", { name: Notifications.push.enable })).toHaveCount(0);
    await screenshot(page, "booking-done-push-ios");

    await card.getByRole("button", { name: Notifications.push.later }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: `وصلنا طلبك #${booked.number}` })).toBeVisible();
    await expect(page.getByRole("region", { name: Notifications.push.iosTitle })).toHaveCount(0);
  });
});

test.describe("admins", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("turn push on from the shell, and a push tap opens the order", async ({ page }) => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${randomUUID()}`;
    await stubPush(page, endpoint);
    const { id: adminId } = await logInAsAdmin(page);

    await page.getByRole("button", { name: Notifications.push.staffEnable }).click();
    await expect(page.getByText(Notifications.push.staffOn)).toBeVisible();
    const saved = await admin.from("push_subscriptions").select("user_id").eq("endpoint", endpoint);
    expect(saved.data).toEqual([{ user_id: adminId }]);

    // A new booking wrote this admin a notification; its push opens it here.
    const customer = await createCustomer();
    const slot = await createSlot();
    const order = await createOrder(customer.phone, { slot, date: baghdadDate(3) });
    const { data: row } = await admin
      .from("notifications")
      .select("id")
      .eq("user_id", adminId)
      .eq("type", "new_booking")
      .eq("order_id", order.id)
      .single()
      .throwOnError();
    await page.goto(`/notifications/${row.id}`);
    await page.waitForURL(`**/admin/orders?order=${order.id}`);
    const { data: read } = await admin
      .from("notifications")
      .select("read_at")
      .eq("id", row.id)
      .single();
    expect(read!.read_at).not.toBeNull();
  });
});

test("a crew's push tap opens its new job", async ({ page }) => {
  await stubPush(page, `https://fcm.googleapis.com/fcm/send/e2e-${randomUUID()}`);
  const crew = await logInAsCrew(page);
  await expect(page.getByRole("button", { name: Notifications.push.staffEnable })).toBeVisible();

  const customer = await createCustomer();
  const slot = await createSlot();
  const order = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(1),
    status: "confirmed",
    crewId: crew.id,
  });
  const { data: row } = await admin
    .from("notifications")
    .select("id")
    .eq("user_id", crew.userId)
    .eq("type", "new_job")
    .single()
    .throwOnError();
  await page.goto(`/notifications/${row.id}`);
  await page.waitForURL(`**/crew/jobs/${order.id}`);
});

test("a guest opening a push is asked to log in first", async ({ page }) => {
  const customer = await createCustomer();
  const [row] = await addNotifications(customer.id, [
    { type: "support_message", data: { excerpt: "هلا" } },
  ]);
  await page.goto(`/notifications/${row!.id}`);
  await page.waitForURL("**/login**");
  expect(new URL(page.url()).searchParams.get("next")).toBe(`/notifications/${row!.id}`);
  const login = new URL(page.url());
  await requestCode(page, customer.phone, `${login.pathname}${login.search}`);
  await enterCode(page, customer.phone);
  await page.waitForURL("**/chat");
});
