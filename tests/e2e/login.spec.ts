import { expect, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

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
import { admin } from "./helpers/supabase";

// Login, OTP, Name and the routing after login (spec §5.1–5.3, N1, §2).
// Serial: one test switches sms_enabled off, which Login reads.
test.describe.configure({ mode: "serial" });

const { Login, Otp, Name, Location, Home, Crew } = messages;

test("Login: أرسل الرمز stays disabled until the number is valid", async ({ page }) => {
  await page.goto("/login");
  const send = page.getByRole("button", { name: Login.send });
  const phone = page.getByLabel(Login.phone);

  await expect(send).toBeDisabled();
  await phone.fill("0612345678");
  await expect(send).toBeDisabled();
  await phone.fill("07801234567");
  await expect(send).toBeEnabled();
  await phone.fill("7801234567");
  await expect(send).toBeEnabled();

  // WhatsApp is picked by default; both channels and the button are 44px+.
  await expect(page.getByRole("radio", { name: Login.whatsapp })).toBeChecked();
  for (const control of [
    page.getByText(Login.whatsapp, { exact: true }),
    page.getByText(Login.sms, { exact: true }),
    send,
    page.getByRole("link", { name: messages.UI.back }),
  ]) {
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByRole("link", { name: "شروط الاستخدام" })).toHaveAttribute(
    "href",
    "/terms",
  );
  await screenshot(page, "login");
});

test("Login hides SMS while sms_enabled is off", async ({ page }) => {
  await admin.from("settings").update({ sms_enabled: false }).eq("id", true).throwOnError();
  try {
    await page.goto("/login");
    await expect(page.getByRole("radio", { name: Login.whatsapp })).toBeChecked();
    await expect(page.getByRole("radio", { name: Login.sms })).toHaveCount(0);
    await expect(page.getByText(Login.introWhatsapp)).toBeVisible();
  } finally {
    await admin.from("settings").update({ sms_enabled: true }).eq("id", true).throwOnError();
  }
  await page.reload();
  await expect(page.getByRole("radio", { name: Login.sms })).toHaveCount(1);
});

test("a new customer goes Login → OTP → Name → Location → Home", async ({ page }) => {
  const phone = newPhone();
  await page.goto("/welcome");
  await page.getByRole("link", { name: messages.Welcome.start }).click();
  await expect(page).toHaveURL("/login");

  await requestCode(page, phone);
  // OTP names the channel used and the real number (spec §5.3 changes).
  await expect(page.getByText(/على واتساب للرقم/)).toBeVisible();
  const local = phone.slice(1);
  await expect(
    page.getByText(`+964 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`),
  ).toBeVisible();
  await expect(page.getByText(Otp.notReceived)).toBeVisible();
  await expect(page.getByLabel(Otp.codeLabel)).toHaveAttribute("autocomplete", "one-time-code");
  await expect(page.getByLabel(Otp.codeLabel)).toHaveAttribute("inputmode", "numeric");
  await screenshot(page, "otp");

  await enterCode(page, phone);
  await page.waitForURL("**/onboarding/name");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(Name.title);
  await screenshot(page, "name");

  // Too short is refused on the server too.
  await page.getByLabel(Name.label).fill(" ا ");
  await page.getByLabel(Name.label).evaluate((el) => el.removeAttribute("minlength"));
  await page.getByRole("button", { name: Name.submit }).click();
  await expect(page.getByText(Name.errors.tooShort)).toBeVisible();

  await page.getByLabel(Name.label).fill("أحمد علي");
  await page.getByRole("button", { name: Name.submit }).click();
  await page.waitForURL("**/addresses/new?onboarding=1");
  // Onboarding: "بعدين" instead of the back button.
  await expect(page.getByRole("link", { name: Location.later })).toBeVisible();
  await expect(page.getByRole("link", { name: messages.UI.back })).toHaveCount(0);
  await screenshot(page, "location");

  await page.getByLabel(Location.district).fill("حي الحسين");
  await page.getByLabel(Location.landmark).fill("قرب جامع الحسين");
  await page.getByRole("button", { name: Location.save }).click();
  await page.waitForURL((url) => url.pathname === "/");

  await expect(page.getByText(/، أحمد$/)).toBeVisible();
  await expect(page.getByRole("button", { name: /البيت · حي الحسين/ })).toBeVisible();
  await screenshot(page, "home");

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("phone", e164(phone))
    .single()
    .throwOnError();
  expect(profile.full_name).toBe("أحمد علي");
});

test("a wrong code says how many tries are left", async ({ page }) => {
  const phone = newPhone();
  await requestCode(page, phone);
  const code = await readCode(phone);
  await page.getByLabel(Otp.codeLabel).fill(code === "000000" ? "111111" : "000000");
  await expect(page.getByText("الرمز غلط، باقي 4 محاولات")).toBeVisible();
  await expect(page).toHaveURL("/login/verify");
  await expect(page.getByLabel(Otp.codeLabel)).toHaveValue("");
});

test("a returning customer goes back to where they were going", async ({ page, context }) => {
  const phone = await signUp(page);
  await context.clearCookies();
  await skipSendLimits(phone);

  await page.goto("/tanks");
  await expect(page).toHaveURL("/login?next=%2Ftanks");
  await requestCode(page, phone, "/login?next=%2Ftanks");
  await enterCode(page, phone);
  await page.waitForURL("**/tanks");
});

test("a customer who skipped Location is asked for it on the next login", async ({
  page,
  context,
}) => {
  const phone = await signUp(page, { address: false });
  await expect(page.getByRole("button", { name: new RegExp(Home.addAddress) })).toBeVisible();
  await context.clearCookies();
  await skipSendLimits(phone);

  await requestCode(page, phone);
  await enterCode(page, phone);
  await page.waitForURL("**/addresses/new?onboarding=1");
});

for (const role of ["crew", "admin"] as const) {
  test(`a ${role} account opens the ${role} surface, not Home`, async ({ page }) => {
    const phone = newPhone();
    const { data, error } = await admin.auth.admin.createUser({
      phone: e164(phone),
      phone_confirm: true,
    });
    if (error) throw error;
    await admin.from("profiles").update({ role }).eq("id", data.user.id).throwOnError();

    await requestCode(page, phone);
    await enterCode(page, phone);
    await page.waitForURL(`**/${role}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      role === "crew" ? Crew.title : messages.Admin.overview.title,
    );

    // Customer pages send them back to their own surface.
    await page.goto("/");
    await expect(page).toHaveURL(`/${role}`);
  });
}

test("logout asks first, then shows Welcome", async ({ page }) => {
  await signUp(page);
  await page.goto("/profile");
  await page.getByRole("button", { name: messages.Profile.logout }).click();
  const dialog = page.getByRole("dialog", { name: messages.Profile.logoutTitle });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: messages.Profile.logoutConfirm }).click();
  await expect(page).toHaveURL("/welcome");
  await page.goto("/profile");
  await expect(page).toHaveURL("/login?next=%2Fprofile");
});
