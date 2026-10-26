import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCustomer, logInAsAdmin } from "./helpers/admin";
import { e164, enterCode, newPhone, requestCode, screenshot, signUp } from "./helpers/auth";
import {
  baghdadDate,
  createOrder,
  createSlot,
  disableSlot,
  type TestSlot,
} from "./helpers/booking";
import { admin } from "./helpers/supabase";

// Chat (spec §5.16), its entry points and the tab bar's unread dot (§5.18).
// Support's side is written directly here; the A4 tests answer through the
// inbox. Working hours are shared settings, so this file runs in order and
// puts them back.

const { Chat, Orders, Order, UI, Admin } = messages;

test.describe.configure({ mode: "serial" });

let slot: TestSlot | null = null;

async function setHours(open: boolean) {
  await admin
    .from("settings")
    .update(
      open
        ? {
            working_days: [0, 1, 2, 3, 4, 5, 6],
            working_hours_start: "00:00",
            working_hours_end: "24:00",
          }
        : { working_days: [], working_hours_start: "09:00", working_hours_end: "21:00" },
    )
    .eq("id", true)
    .throwOnError();
}

test.beforeEach(async () => {
  await setHours(true);
});

test.afterEach(async () => {
  await admin
    .from("settings")
    .update({
      working_days: [0, 1, 2, 3, 4, 6],
      working_hours_start: "09:00",
      working_hours_end: "21:00",
    })
    .eq("id", true)
    .throwOnError();
  if (slot) await disableSlot(slot.id);
  slot = null;
});

const main = (page: Page) => page.locator("main").filter({ visible: true });

/** An admin account (not logged in) to write support's answers. */
async function supportAgent() {
  const { data, error } = await admin.auth.admin.createUser({
    phone: e164(newPhone()),
    phone_confirm: true,
  });
  if (error) throw error;
  await admin
    .from("profiles")
    .update({ role: "admin", full_name: "دعم" })
    .eq("id", data.user.id)
    .throwOnError();
  return data.user.id;
}

/** Support answers in the customer's thread, as send_chat_message would write it. */
async function answer(customerId: string, agentId: string, body: string) {
  const { data: thread } = await admin
    .from("chat_threads")
    .select("id")
    .eq("user_id", customerId)
    .single()
    .throwOnError();
  await admin
    .from("chat_messages")
    .insert({
      thread_id: thread.id,
      customer_id: customerId,
      author: "admin",
      sender_id: agentId,
      body,
      client_id: crypto.randomUUID(),
    })
    .throwOnError();
  return thread.id;
}

async function customerId(phone: string) {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", e164(phone))
    .single()
    .throwOnError();
  return data.id;
}

test("a customer writes to support, gets the answer live, and sees it was read", async ({
  page,
}) => {
  await admin
    .from("settings")
    .update({ company_phone: "+9647801234567" })
    .eq("id", true)
    .throwOnError();
  const phone = await signUp(page);
  const agent = await supportAgent();

  await page.goto("/chat");
  const chat = main(page);
  await expect(chat.getByRole("heading", { name: Chat.title })).toBeVisible();
  await expect(chat.getByText(Chat.open)).toBeVisible();
  await expect(chat.getByText(Chat.welcome)).toBeVisible();
  await expect(chat.getByRole("link", { name: Chat.call })).toHaveAttribute(
    "href",
    "tel:+9647801234567",
  );
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");

  const box = chat.getByLabel(Chat.composer.label);
  await box.fill("أريد أغير موعد طلب #1024 لساعة 9 الصبح بدل 10");
  await box.press("Enter");
  const list = chat.getByRole("list", { name: Chat.messagesLabel });
  await expect(list.getByText("أريد أغير موعد طلب #1024")).toBeVisible();
  await expect(list.getByText(Chat.status.sent)).toBeAttached();
  await expect(box).toHaveValue("");

  // Support answers: it arrives without a reload and is marked read at once.
  const id = await customerId(phone);
  const threadId = await answer(id, agent, "تم، غيرنا الموعد لساعة 9 الصبح ووصلك إشعار بالتأكيد.");
  await expect(list.getByText("تم، غيرنا الموعد")).toBeVisible();
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("chat_threads")
        .select("customer_unread")
        .eq("id", threadId)
        .single();
      return data?.customer_unread;
    })
    .toBe(0);

  // A photo with a caption: shrunk, uploaded over TUS, then sent.
  await box.fill("وهذي صورة للتسريب");
  await chat.locator('input[type="file"]').setInputFiles("tests/e2e/fixtures/tank.jpg");
  await expect(list.getByRole("button", { name: Chat.openPhoto })).toBeVisible();
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("chat_messages")
        .select("media_type, body")
        .eq("thread_id", threadId)
        .not("media_path", "is", null);
      return data;
    })
    .toEqual([{ media_type: "photo", body: "وهذي صورة للتسريب" }]);

  // Support reads them: ✓✓.
  await admin
    .from("chat_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("thread_id", threadId)
    .eq("author", "customer")
    .throwOnError();
  await expect(list.getByText(Chat.status.read)).toHaveCount(2);

  for (const control of [
    chat.getByRole("link", { name: UI.back }),
    chat.getByRole("button", { name: Chat.composer.attach }),
    chat.getByRole("button", { name: Chat.composer.send }),
    chat.getByRole("button", { name: Chat.topics.price }),
  ]) {
    const size = await control.boundingBox();
    expect(size?.width).toBeGreaterThanOrEqual(44);
    expect(size?.height).toBeGreaterThanOrEqual(36);
  }
  await expect(list.getByText(Chat.today)).toBeVisible();
  await screenshot(page, "chat");
});

test("the cancel topic tags an order and offers N6 while the 2-hour rule allows", async ({
  page,
}) => {
  slot = await createSlot();
  const phone = await signUp(page);
  const order = await createOrder(phone, { slot, date: baghdadDate(3) });

  await page.goto("/chat");
  const chat = main(page);
  await chat.getByRole("button", { name: Chat.topics.price }).click();
  const list = chat.getByRole("list", { name: Chat.messagesLabel });
  await expect(list.getByText(Chat.topicText.price)).toBeVisible();

  await chat.getByRole("button", { name: Chat.topics.cancel }).click();
  const picker = page.getByRole("dialog", { name: Chat.picker.cancel });
  await picker.getByRole("button", { name: new RegExp(`#${order.number}`) }).click();
  await expect(list.getByText(`أريد ألغي طلب #${order.number}`)).toBeVisible();

  await list.getByRole("button", { name: Chat.actions.cancel }).click();
  const sheet = page.getByRole("dialog", { name: Order.cancelSheet.title });
  await sheet.locator("label").filter({ hasText: Order.reasons.other }).click();
  await sheet.getByRole("button", { name: Order.cancelSheet.confirm }).click();
  await expect(sheet).toBeHidden();
  await expect
    .poll(
      async () =>
        (await admin.from("orders").select("status").eq("id", order.id).single()).data?.status,
    )
    .toBe("cancelled");
  // The order can't change any more: no button.
  await expect(list.getByRole("button", { name: Chat.actions.cancel })).toHaveCount(0);
});

test("مساعدة on Orders tags the next message with the order", async ({ page }) => {
  slot = await createSlot();
  const phone = await signUp(page);
  const order = await createOrder(phone, { slot, date: baghdadDate(2), status: "confirmed" });

  await page.goto("/orders");
  await main(page).getByRole("link", { name: Orders.help }).click();
  await page.waitForURL(`**/chat?order=${order.id}`);
  const chat = main(page);
  await expect(chat.getByText(`عن طلب #${order.number}`)).toBeVisible();
  const box = chat.getByLabel(Chat.composer.label);
  await box.fill("الفريق راح يجي الصبح؟");
  await box.press("Enter");
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("chat_messages")
        .select("order_id")
        .eq("customer_id", await customerId(phone))
        .eq("body", "الفريق راح يجي الصبح؟");
      return data;
    })
    .toEqual([{ order_id: order.id }]);
  // The tag goes with one message.
  await expect(chat.getByRole("button", { name: Chat.removeTag })).toHaveCount(0);

  // N4 offers the same.
  await page.goto(`/orders/${order.id}`);
  await expect(main(page).getByRole("link", { name: Order.helpButton })).toHaveAttribute(
    "href",
    `/chat?order=${order.id}`,
  );
});

test("outside working hours the header says so and one automatic reply comes", async ({ page }) => {
  await setHours(false);
  const { data: settings } = await admin
    .from("settings")
    .select("support_response_text")
    .single()
    .throwOnError();
  await signUp(page);
  await page.goto("/chat");
  const chat = main(page);
  await expect(chat.getByText("نرد بأوقات الدوام 9 ص–9 م")).toBeVisible();

  const box = chat.getByLabel(Chat.composer.label);
  for (const text of ["مرحبا", "أكو أحد؟"]) {
    await box.fill(text);
    await box.press("Enter");
    await expect(chat.getByText(text)).toBeVisible();
  }
  await expect(chat.getByText(settings.support_response_text)).toHaveCount(1);
});

test("the tab bar shows unread answers until Chat is opened", async ({ page }) => {
  const customer = await createCustomer();
  const agent = await supportAgent();
  await requestCode(page, customer.phone);
  await enterCode(page, customer.phone);
  await page.waitForURL((url) => url.pathname === "/");

  const tab = (name: string) =>
    page
      .getByRole("navigation", { name: UI.tabs.label })
      .filter({ visible: true })
      .getByRole("link", { name });
  await expect(tab(UI.tabs.chat)).toBeVisible();
  await expect(tab(UI.tabs.chatUnread)).toHaveCount(0);

  // An answer arrives while Home is open: the dot shows without a reload.
  await admin.from("chat_threads").insert({ user_id: customer.id }).throwOnError();
  await answer(customer.id, agent, "هلا بيك، شلون نكدر نساعدك؟");
  await expect(tab(UI.tabs.chatUnread)).toBeVisible();

  await tab(UI.tabs.chatUnread).click();
  await page.waitForURL("**/chat");
  await expect(main(page).getByText("هلا بيك، شلون نكدر نساعدك؟")).toBeVisible();
  await page.goto("/orders");
  await expect(tab(UI.tabs.chat)).toBeVisible();
  await expect(tab(UI.tabs.chatUnread)).toHaveCount(0);
});

test("support answers from the inbox: the customer sees ✓✓ and the answer live", async ({
  page,
  browser,
}) => {
  slot = await createSlot();
  const phone = await signUp(page, { name: "زيد التجربة" });
  const order = await createOrder(phone, { slot, date: baghdadDate(2), status: "confirmed" });
  await page.goto(`/chat?order=${order.id}`);
  const chat = main(page);
  const box = chat.getByLabel(Chat.composer.label);
  await box.fill("متى يوصل الفريق؟");
  await box.press("Enter");
  const list = chat.getByRole("list", { name: Chat.messagesLabel });
  await expect(list.getByText(Chat.status.sent)).toBeAttached();

  const desk = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ar-IQ",
    timezoneId: "Asia/Baghdad",
  });
  const adminPage = await desk.newPage();
  await logInAsAdmin(adminPage);
  const nav = adminPage.getByRole("navigation", { name: Admin.nav.label });
  await expect(nav.getByRole("link", { name: Admin.nav.chat })).toContainText(/\d/);

  // A1 lists the unread conversation.
  const unreadOnA1 = adminPage.getByRole("list", { name: Admin.overview.chatsCaption });
  await expect(unreadOnA1.getByRole("link", { name: /زيد التجربة/ })).toBeVisible();

  // The inbox finds it by phone, unread.
  await adminPage.goto(`/admin/chat?q=${phone}`);
  const inbox = adminPage.getByRole("navigation", { name: Admin.chat.listLabel });
  await inbox.getByRole("link", { name: /زيد التجربة/ }).click();
  await adminPage.waitForURL(/\/admin\/chat\/[0-9a-f-]{36}/);
  const thread = main(adminPage);
  const conversation = thread.getByRole("list", { name: Chat.messagesLabel });
  await expect(thread.getByRole("heading", { name: "زيد التجربة" })).toBeVisible();
  await expect(conversation.getByText("متى يوصل الفريق؟")).toBeVisible();
  await expect(conversation.getByRole("link", { name: `عن طلب #${order.number}` })).toHaveAttribute(
    "href",
    `/admin/orders?order=${order.id}`,
  );
  // The side panel lists the order.
  await expect(
    thread
      .getByRole("complementary")
      .getByRole("link", { name: new RegExp(`طلب #${order.number}`) }),
  ).toBeVisible();

  // Opening it marked the message read: ✓✓ on the customer's phone, live.
  await expect(list.getByText(Chat.status.read)).toBeAttached();

  // A canned reply, edited before sending.
  await thread.getByRole("button", { name: Admin.chat.canned.greet }).click();
  const reply = thread.getByLabel(Chat.composer.label);
  await expect(reply).toHaveValue(Admin.chat.canned.greet);
  await reply.press("Enter");
  await expect(list.getByText(Admin.chat.canned.greet)).toBeVisible();
  await screenshot(adminPage, "admin-chat");
  await desk.close();
});

test("an admin edits the automatic reply in A13", async ({ page }) => {
  const { data } = await admin
    .from("settings")
    .select("support_response_text")
    .single()
    .throwOnError();
  try {
    await logInAsAdmin(page);
    await page.goto("/admin/settings");
    const form = page.getByRole("form", { name: Admin.settings.chat.title });
    const field = form.getByLabel(Admin.settings.chat.text);
    // Typing before the page hydrates can be undone by it: retry until the
    // box holds exactly the new text.
    await expect(async () => {
      await field.fill("وصلت رسالتك، نرد عليك الصبح.");
      await expect(field).toHaveValue("وصلت رسالتك، نرد عليك الصبح.", { timeout: 1000 });
    }).toPass();
    await form.getByRole("button", { name: Admin.settings.save }).click();
    await expect(form.getByText(Admin.settings.saved, { exact: true })).toBeVisible();
    const { data: saved } = await admin
      .from("settings")
      .select("support_response_text")
      .single()
      .throwOnError();
    expect(saved.support_response_text).toBe("وصلت رسالتك، نرد عليك الصبح.");
  } finally {
    await admin
      .from("settings")
      .update({ support_response_text: data.support_response_text })
      .eq("id", true)
      .throwOnError();
  }
});
