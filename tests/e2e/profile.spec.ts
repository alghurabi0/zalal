import { rm } from "node:fs/promises";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCustomer } from "./helpers/admin";
import {
  e164,
  enterCode,
  newPhone,
  readCode,
  requestCode,
  screenshot,
  signUp,
  skipSendLimits,
} from "./helpers/auth";
import {
  baghdadDate,
  createCertificate,
  createOrder,
  createSlot,
  disableSlot,
  type TestSlot,
  userIdFor,
} from "./helpers/booking";
import { OTP_OUTBOX } from "./helpers/outbox";
import { admin } from "./helpers/supabase";

// Profile and its screens (Phase 6, task 3; settled Oct 28, 2026): the rows
// and reminder toggle, Edit profile (N10) with the two-code phone change,
// Certificates (N12), Settings (N13) with Terms, log out everywhere and
// account deletion, Home's quick actions, and N16's force update and out of
// area. Maintenance mode is global, so it lives in system-states.spec.ts,
// which runs after everything else.

const { Profile, EditProfile, PhoneChange, Certificates, Settings, Legal, Home, System, Otp } =
  messages;

let slot: TestSlot | null = null;
test.afterEach(async () => {
  if (slot) await disableSlot(slot.id);
  slot = null;
});

async function logIn(page: Page, phone: string) {
  await requestCode(page, phone);
  await enterCode(page, phone);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("Profile shows the canvas rows and saves the reminder toggle", async ({ page }) => {
  const phone = await signUp(page);
  await page.goto("/profile");

  await expect(page.getByText(Profile.paymentValue)).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(Profile.certificates) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(Profile.settings) })).toBeVisible();
  await expect(page.getByRole("link", { name: Profile.help })).toHaveAttribute("href", "/chat");
  await screenshot(page, "profile");

  const toggle = page.getByRole("switch", { name: Profile.reminders });
  await expect(toggle).toBeChecked();
  // The whole row is the label.
  await page.getByText(Profile.reminders).click();
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("profiles")
        .select("reminders_enabled")
        .eq("phone", e164(phone))
        .single();
      return data?.reminders_enabled;
    })
    .toBe(false);
  await page.reload();
  await expect(page.getByRole("switch", { name: Profile.reminders })).not.toBeChecked();
});

test("Edit profile saves the name", async ({ page }) => {
  await signUp(page, { name: "أحمد علي" });
  await page.goto("/profile");
  await page.getByRole("link", { name: Profile.editLabel }).click();
  await expect(page).toHaveURL("/profile/edit");
  await page.getByLabel(messages.Name.label).fill("  علي   حسن ");
  await page.getByRole("button", { name: EditProfile.save }).click();
  await expect(page).toHaveURL("/profile");
  await expect(page.getByText("علي حسن", { exact: true })).toBeVisible();
});

test("the phone changes after codes to the current and the new number", async ({ page }) => {
  test.setTimeout(90_000);
  const oldPhone = await signUp(page, { name: "صاحب الرقم" });
  const nextPhone = newPhone();

  await page.goto("/profile/edit");
  await page.getByRole("link", { name: EditProfile.changePhone }).click();
  await expect(page.getByText(PhoneChange.step.replace("{n}", "1"))).toBeVisible();
  // The code goes to the current number first.
  await requestFresh(oldPhone);
  await page.getByRole("button", { name: PhoneChange.send }).click();
  await page.waitForURL("**/profile/phone/verify");
  await expect(page.getByRole("link", { name: Otp.changeNumber })).toHaveCount(0);
  await page.getByLabel(Otp.codeLabel).fill(await readCode(oldPhone));

  // Then the new number.
  await page.waitForURL("**/profile/phone");
  await expect(page.getByText(PhoneChange.step.replace("{n}", "2"))).toBeVisible();
  await page.getByLabel(PhoneChange.newPhone).fill(nextPhone.slice(1));
  await page.getByRole("button", { name: PhoneChange.send }).click();
  await page.waitForURL("**/profile/phone/verify");
  await page.getByLabel(Otp.codeLabel).fill(await readCode(nextPhone));

  await page.waitForURL("**/profile/edit?phone=changed");
  await expect(page.getByText(EditProfile.phoneChanged)).toBeVisible();
  const { data } = await admin
    .from("profiles")
    .select("phone")
    .eq("id", await userIdFor(nextPhone))
    .single()
    .throwOnError();
  expect(data.phone).toBe(e164(nextPhone));
});

test("the phone change refuses a number that has an account", async ({ page }) => {
  const other = await createCustomer("صاحب رقم ثاني");
  const phone = await signUp(page);
  await page.goto("/profile/phone");
  await requestFresh(phone);
  await page.getByRole("button", { name: PhoneChange.send }).click();
  await page.waitForURL("**/profile/phone/verify");
  await page.getByLabel(Otp.codeLabel).fill(await readCode(phone));
  await page.waitForURL("**/profile/phone");
  await page.getByLabel(PhoneChange.newPhone).fill(other.phone.slice(1));
  await page.getByRole("button", { name: PhoneChange.send }).click();
  await expect(page.getByText(messages.Login.errors.phoneTaken)).toBeVisible();
});

test("Certificates lists the customer's certificates and opens Report", async ({ page }) => {
  slot = await createSlot();
  const customer = await createCustomer("زبون الشهادات");
  const order = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(0),
    status: "completed",
  });
  await createCertificate(order.id);
  await logIn(page, customer.phone);

  await page.goto("/profile");
  await expect(page.getByRole("link", { name: new RegExp(Profile.certificates) })).toContainText(
    "1",
  );
  await page.getByRole("link", { name: new RegExp(Profile.certificates) }).click();
  await expect(page).toHaveURL("/profile/certificates");
  const card = page.getByRole("link", { name: new RegExp(`ZL-${order.number}`) });
  await expect(card).toBeVisible();
  await screenshot(page, "certificates");
  await card.click();
  await expect(page).toHaveURL(`/orders/${order.id}/certificate`);
});

test("Certificates is empty before the first cleaning", async ({ page }) => {
  await signUp(page);
  await page.goto("/profile/certificates");
  await expect(page.getByText(Certificates.empty)).toBeVisible();
  await expect(page.getByRole("link", { name: Certificates.book })).toBeVisible();
});

test("Settings opens Terms, which goes back to Settings", async ({ page }) => {
  await signUp(page);
  await page.goto("/profile/settings");
  await expect(page.getByText(Settings.languageValue)).toBeVisible();
  await screenshot(page, "settings");
  await page.getByRole("link", { name: Settings.terms }).click();
  await expect(page).toHaveURL("/terms?from=settings");
  await expect(page.getByRole("heading", { name: Legal.terms })).toBeVisible();
  await page.getByRole("link", { name: messages.UI.back }).click();
  await expect(page).toHaveURL("/profile/settings");
});

test("account deletion waits for open orders, then frees the phone", async ({ page }) => {
  test.setTimeout(90_000);
  slot = await createSlot();
  const phone = await signUp(page, { name: "زبون يحذف" });
  const order = await createOrder(phone, { slot, date: baghdadDate(3) });

  await page.goto("/profile/settings");
  await page.getByRole("button", { name: Settings.deleteAccount }).click();
  const sheet = page.getByRole("dialog", { name: Settings.deleteTitle });
  await expect(sheet.getByText(Settings.openOrders)).toBeVisible();
  await expect(sheet.getByRole("button", { name: Settings.deleteConfirm })).toHaveCount(0);
  await sheet.getByRole("button", { name: Settings.cancel, exact: true }).click();

  await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id).throwOnError();
  await admin.from("slot_bookings").delete().eq("order_id", order.id).throwOnError();
  await page.reload();
  await page.getByRole("button", { name: Settings.deleteAccount }).click();
  await sheet.getByRole("button", { name: Settings.deleteContinue }).click();
  await expect(sheet.getByText(Settings.deleteSure)).toBeVisible();
  await sheet.getByRole("button", { name: Settings.deleteConfirm }).click();
  await page.waitForURL("**/welcome");

  const { data } = await admin
    .from("orders")
    .select("landmark, customer_id")
    .eq("id", order.id)
    .single()
    .throwOnError();
  expect(data.landmark).toBe("-deleted-");
  const { data: profile } = await admin
    .from("profiles")
    .select("phone, full_name, deleted_at")
    .eq("id", data.customer_id)
    .single()
    .throwOnError();
  expect(profile).toMatchObject({ phone: null, full_name: null });

  // The same number starts over as a new account.
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login/);
  await requestFresh(phone);
  await requestCode(page, phone);
  await enterCode(page, phone);
  await page.waitForURL("**/onboarding/name**");
});

test("log out on all devices ends this session and every browser's pushes", async ({ page }) => {
  const phone = await signUp(page);
  const userId = await userIdFor(phone);
  await admin
    .from("push_subscriptions")
    .insert({
      user_id: userId,
      endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${phone}`,
      p256dh: `B${"a".repeat(86)}`,
      auth: "b".repeat(22),
    })
    .throwOnError();

  await page.goto("/profile/settings");
  await page.getByRole("button", { name: Settings.logoutEverywhere }).click();
  await page
    .getByRole("dialog", { name: Settings.logoutEverywhereTitle })
    .getByRole("button", { name: Settings.logoutEverywhereConfirm })
    .click();
  await page.waitForURL("**/welcome");

  // Other devices' refresh tokens are gone too (tests/integration/account.test.ts);
  // their current access token lasts until it expires (up to an hour).
  const { count } = await admin
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  expect(count).toBe(0);
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login/);
});

test("Home's quick actions open their screens, for customers only", async ({ page }) => {
  await page.goto("/welcome");
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: Home.quick.label })).toHaveCount(0);

  await signUp(page);
  const quick = page.getByRole("navigation", { name: Home.quick.label });
  await expect(quick.getByRole("link")).toHaveText([
    Home.quick.subscription,
    Home.quick.certificates,
    Home.quick.chat,
    Home.quick.issue,
  ]);
  await screenshot(page, "home-quick-actions");
  await quick.getByRole("link", { name: Home.quick.certificates }).click();
  await expect(page).toHaveURL("/profile/certificates");
});

test("an older build is asked to update (force update)", async ({ page }) => {
  // Only this page sees a higher minimum version: the real setting stays.
  await page.route("**/rest/v1/settings?select=min_app_version*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, min_app_version: "999.0.0" },
    });
  });
  await page.goto("/tips");
  const dialog = page.getByRole("alertdialog", { name: System.updateTitle });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: System.update })).toBeVisible();
  await screenshot(page, "force-update");
});

test.describe("outside Karbala", () => {
  // Baghdad: outside the seeded service area.
  test.use({
    geolocation: { latitude: 33.3152, longitude: 44.3661 },
    permissions: ["geolocation"],
  });

  test("a new user's first pin outside the area gets the full-screen state", async ({ page }) => {
    const phone = newPhone();
    await requestCode(page, phone);
    await enterCode(page, phone);
    await page.waitForURL("**/onboarding/name**");
    await page.getByLabel(messages.Name.label).fill("زبون بعيد");
    await page.getByRole("button", { name: messages.Name.submit }).click();
    await page.waitForURL("**/addresses/new?onboarding=1**");
    await page.getByLabel(messages.Location.district).fill("المنصور");
    await page.getByLabel(messages.Location.landmark).fill("قرب الساعة");
    await page.getByRole("button", { name: messages.Location.save }).click();

    const state = page.getByRole("alertdialog", { name: System.outOfAreaTitle });
    await expect(state).toBeVisible();
    await screenshot(page, "out-of-area");
    await state.getByRole("button", { name: System.changePin }).click();
    await expect(state).toHaveCount(0);
    await expect(page.getByRole("button", { name: messages.Location.save })).toBeVisible();
  });
});

/**
 * Before a code the test sends itself: moves the number's earlier sends back
 * past the send limits and forgets the last code in the outbox, so readCode
 * waits for the new one.
 */
async function requestFresh(local: string) {
  await skipSendLimits(local);
  await rm(path.join(OTP_OUTBOX, e164(local)), { force: true });
}
