import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { screenshot, signUp } from "./helpers/auth";
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

// Orders (spec §5.12), Order details (N4), Cancel (N6), Reschedule (N7) and
// Home's live cards (§5.5).

const { Orders, Order, Home, Tanks } = messages;
const HOUR = 60 * 60 * 1000;

let slot: TestSlot | null = null;
test.afterEach(async () => {
  if (slot) await disableSlot(slot.id);
  slot = null;
});

const visible = (page: Page) => page.locator("main").filter({ visible: true });

test("Orders splits current and past orders, with a button by status", async ({ page }) => {
  slot = await createSlot();
  const phone = await signUp(page);
  const pending = await createOrder(phone, { slot, date: baghdadDate(2) });
  const onTheWay = await createOrder(phone, {
    slot,
    date: baghdadDate(1),
    status: "on_the_way",
    lines: [
      { tank_type: "roof", size: "m", qty: 2, unit_price_iqd: 35000 },
      { tank_type: "ground", size: "l", qty: 1, unit_price_iqd: 120000 },
    ],
  });
  const cancelled = await createOrder(phone, { slot, date: baghdadDate(3), status: "cancelled" });
  const completed = await createOrder(phone, { slot, date: baghdadDate(0), status: "completed" });

  await page.goto("/orders");
  const main = visible(page);
  await expect(main.getByRole("heading", { name: Orders.title })).toBeVisible();
  await expect(main.getByRole("link", { name: Orders.tabs.current })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const cards = main.getByRole("list", { name: Orders.title }).getByRole("listitem");
  await expect(cards).toHaveCount(2);
  // Soonest first.
  await expect(cards.nth(0)).toContainText(`#${onTheWay.number}`);
  await expect(cards.nth(0)).toContainText(Orders.status.on_the_way);
  await expect(cards.nth(0)).toContainText("3 خزانات");
  await expect(cards.nth(0)).toContainText("190,000");
  await expect(cards.nth(1)).toContainText(`#${pending.number}`);
  await expect(cards.nth(1)).toContainText(Orders.status.pending_confirmation);
  await expect(cards.nth(1)).toContainText("خزان سطح · 1,000–2,000");
  await expect(cards.nth(1)).toContainText("البيت · حي الحسين");
  await expect(cards.nth(1).getByRole("link", { name: Orders.details })).toHaveAttribute(
    "href",
    `/orders/${pending.id}`,
  );
  await screenshot(page, "orders");

  await main.getByRole("link", { name: Orders.tabs.past }).click();
  await expect(page).toHaveURL("/orders?tab=past");
  const past = visible(page).getByRole("list", { name: Orders.title }).getByRole("listitem");
  await expect(past).toHaveCount(2);
  const cancelledCard = past.filter({ hasText: `#${cancelled.number}` });
  await expect(cancelledCard).toContainText(Orders.status.cancelled);
  await expect(cancelledCard.getByRole("link", { name: Orders.rebook })).toHaveAttribute(
    "href",
    "/book",
  );
  await expect(past.filter({ hasText: `#${completed.number}` })).toContainText(
    Orders.status.completed,
  );

  // The card opens Order details.
  await past
    .filter({ hasText: `#${completed.number}` })
    .getByRole("link", { name: new RegExp(`#${completed.number}`) })
    .click();
  await expect(page).toHaveURL(`/orders/${completed.id}`);
});

test("Orders shows an empty state per tab", async ({ page }) => {
  await signUp(page);
  await page.goto("/orders?tab=past");
  await expect(visible(page).getByRole("heading", { name: Orders.emptyPastTitle })).toBeVisible();
  await visible(page).getByRole("link", { name: Orders.tabs.current }).click();
  await expect(
    visible(page).getByRole("heading", { name: Orders.emptyCurrentTitle }),
  ).toBeVisible();
  await expect(visible(page).getByRole("link", { name: Orders.book })).toHaveAttribute(
    "href",
    "/book",
  );
});

test("Order details: summary and timeline, then cancel with a reason", async ({ page }) => {
  slot = await createSlot();
  const phone = await signUp(page);
  const order = await createOrder(phone, { slot, date: baghdadDate(2) });

  await page.goto(`/orders/${order.id}`);
  const main = visible(page);
  await expect(main.getByRole("heading", { name: `طلب #${order.number}` })).toBeVisible();
  await expect(main.getByText(Orders.status.pending_confirmation)).toBeVisible();
  await expect(main.getByText(slot.label)).toBeVisible();
  await expect(main.getByText("تنظيف وتعقيم خزان سطح · 1,000–2,000 × 1")).toBeVisible();
  await expect(main.getByText(Order.events.booked)).toBeVisible();
  await expect(main.getByText(Order.changeHint)).toBeVisible();
  await screenshot(page, "order-details");

  await main.getByRole("button", { name: Order.cancel }).click();
  const sheet = page.getByRole("dialog", { name: Order.cancelSheet.title });
  await expect(sheet.getByRole("button", { name: Order.cancelSheet.confirm })).toBeDisabled();
  await sheet.locator("label").filter({ hasText: Order.reasons.time_unsuitable }).click();
  await screenshot(page, "order-cancel");
  await sheet.getByRole("button", { name: Order.cancelSheet.confirm }).click();
  await expect(sheet).toBeHidden();

  await expect(main.getByText(Orders.status.cancelled)).toBeVisible();
  await expect(main.getByText(`ألغيت الطلب · ${Order.reasons.time_unsuitable}`)).toBeVisible();
  await expect(main.getByRole("link", { name: Order.rebook })).toHaveAttribute("href", "/book");

  const { data } = await admin
    .from("orders")
    .select("status, slot_bookings(seat), order_events(to_status, cancel_reason)")
    .eq("id", order.id)
    .single()
    .throwOnError();
  expect(data.status).toBe("cancelled");
  expect(data.slot_bookings).toBeNull();
  expect(data.order_events).toContainEqual({
    to_status: "cancelled",
    cancel_reason: "time_unsuitable",
  });
});

test("cancel and reschedule are blocked 1 h 59 min before the slot", async ({ page }) => {
  slot = await createSlot();
  const phone = await signUp(page);
  const order = await createOrder(phone, {
    slot,
    date: baghdadDate(0),
    status: "confirmed",
    startAt: new Date(Date.now() + 2 * HOUR - 60_000),
  });

  await page.goto(`/orders/${order.id}`);
  const main = visible(page);
  await expect(main.getByText(Order.tooLateHint)).toBeVisible();

  for (const button of [Order.cancel, Order.reschedule]) {
    await main.getByRole("button", { name: button }).click();
    const sheet = page.getByRole("dialog", { name: Order.blocked.title });
    await expect(sheet.getByText(Order.blocked.body)).toBeVisible();
    await expect(sheet.getByRole("button", { name: Order.cancelSheet.confirm })).toHaveCount(0);
    await sheet.getByRole("button", { name: Order.blocked.ok }).click();
    await expect(sheet).toBeHidden();
  }

  const { data } = await admin.from("orders").select("status").eq("id", order.id).single();
  expect(data?.status).toBe("confirmed");
});

test("a cancel sent after the cutoff passed is refused by the database", async ({ page }) => {
  slot = await createSlot();
  const phone = await signUp(page);
  const order = await createOrder(phone, {
    slot,
    date: baghdadDate(0),
    startAt: new Date(Date.now() + 3 * HOUR),
  });

  await page.goto(`/orders/${order.id}`);
  await visible(page).getByRole("button", { name: Order.cancel }).click();
  const sheet = page.getByRole("dialog", { name: Order.cancelSheet.title });
  await sheet.locator("label").filter({ hasText: Order.reasons.plans_changed }).click();

  // Meanwhile the slot is only 1 h 59 min away.
  await admin
    .from("orders")
    .update({ slot_start_at: new Date(Date.now() + 2 * HOUR - 60_000).toISOString() })
    .eq("id", order.id)
    .throwOnError();
  await sheet.getByRole("button", { name: Order.cancelSheet.confirm }).click();

  await expect(
    page.getByRole("dialog", { name: Order.blocked.title }).getByText(Order.blocked.body),
  ).toBeVisible();
  const { data } = await admin.from("orders").select("status").eq("id", order.id).single();
  expect(data?.status).toBe("pending_confirmation");
});

test("reschedule moves the order to a new day and back to pending", async ({ page }) => {
  slot = await createSlot();
  const phone = await signUp(page);
  const from = baghdadDate(2);
  const to = baghdadDate(3);
  const order = await createOrder(phone, { slot, date: from, status: "confirmed" });

  await page.goto(`/orders/${order.id}`);
  const main = visible(page);
  await expect(main.getByText(Orders.status.confirmed)).toBeVisible();
  await main.getByRole("button", { name: Order.reschedule }).click();
  const sheet = page.getByRole("dialog", { name: Order.rescheduleSheet.title });

  // The current slot is shown but can't be picked again.
  await sheet
    .locator("label")
    .filter({ has: page.locator(`input[name$="-day"][value="${from}"]`) })
    .click();
  await expect(
    sheet.getByRole("radio", {
      name: new RegExp(`${slot.label}.*${messages.Booking.currentSlot}`),
    }),
  ).toBeDisabled();

  await pickSlot(page, to, slot.label);
  await screenshot(page, "order-reschedule");
  await sheet.getByRole("button", { name: Order.rescheduleSheet.confirm }).click();
  await expect(sheet).toBeHidden();

  await expect(main.getByText(Orders.status.pending_confirmation)).toBeVisible();
  await expect(main.getByText(/غيّرت الموعد إلى/)).toBeVisible();
  const { data } = await admin
    .from("orders")
    .select("status, service_date, slot_bookings(service_date)")
    .eq("id", order.id)
    .single()
    .throwOnError();
  expect(data).toMatchObject({
    status: "pending_confirmation",
    service_date: to,
    slot_bookings: { service_date: to },
  });
});

test("Home shows the active order live and the tank status", async ({ page }) => {
  slot = await createSlot();
  const phone = await signUp(page);
  const main = visible(page);

  // No order yet, and no cleaning history.
  await expect(main.getByText(Home.tank.noHistory)).toBeVisible();
  await expect(main.getByRole("link", { name: Home.tank.book })).toHaveAttribute("href", "/book");

  const order = await createOrder(phone, { slot, date: baghdadDate(1) });
  const customerId = await userIdFor(phone);
  const { data: address } = await admin
    .from("addresses")
    .select("id")
    .eq("user_id", customerId)
    .single()
    .throwOnError();
  const sevenMonthsAgo = new Date();
  sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 7);
  sevenMonthsAgo.setDate(sevenMonthsAgo.getDate() - 1);
  await admin
    .from("tanks")
    .insert({
      user_id: customerId,
      address_id: address.id,
      type: "roof",
      size: "m",
      last_cleaned_at: sevenMonthsAgo.toISOString(),
    })
    .throwOnError();

  await page.reload();
  const card = main.getByRole("link", { name: new RegExp(`#${order.number}`) });
  await expect(card).toContainText(Home.activeOrder.pending_confirmation);
  await expect(card).toHaveAttribute("href", `/orders/${order.id}`);
  await expect(main.getByText(Home.tank.overdue, { exact: true })).toBeVisible();
  await expect(main.getByText("آخر تنظيف: قبل 7 أشهر")).toBeVisible();
  await expect(main.getByText("الموصى به: كل 6 أشهر")).toBeVisible();
  await screenshot(page, "home");

  // The company confirms and the crew sets out: the card follows, no reload.
  await admin.from("orders").update({ status: "on_the_way" }).eq("id", order.id).throwOnError();
  await expect(card).toContainText(Home.activeOrder.on_the_way);
});

test("a guest sees the price list and books through login", async ({ page, context }) => {
  await context.addCookies([{ name: "zl_welcomed", value: "1", url: "http://localhost:3100" }]);
  await page.goto("/");
  const main = visible(page);
  await expect(main.getByRole("heading", { name: Home.prices.title })).toBeVisible();
  await expect(main.getByText(`${Tanks.types.roof} · ${Tanks.sizes.m}`)).toBeVisible();
  await expect(main.getByText("35,000 د.ع")).toBeVisible();
  await expect(main.getByText(Home.tank.title)).toHaveCount(0);
  await screenshot(page, "home-guest");

  await main.getByRole("link", { name: Home.prices.book }).click();
  await expect(page).toHaveURL("/login?next=%2Fbook");
});
