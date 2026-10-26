import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { enterCode, requestCode, screenshot, signUp, skipSendLimits } from "./helpers/auth";
import {
  baghdadDate,
  createSlot,
  disableSlot,
  fillSlot,
  pickSlot,
  type TestSlot,
  userIdFor,
} from "./helpers/booking";
import { admin } from "./helpers/supabase";

// Booking 1–3 (spec §5.9–5.11) and Booking success (N5).

const { Booking, Upload, Checkout, BookingDone, Tanks } = messages;
const fixture = (name: string) => path.resolve("tests/e2e/fixtures", name);

let slot: TestSlot | null = null;
test.afterEach(async () => {
  if (slot) await disableSlot(slot.id);
  slot = null;
});

async function expectTouchTargets(page: Page, names: (string | RegExp)[]) {
  for (const name of names) {
    const box = await page
      .getByRole("button", { name })
      .filter({ visible: true })
      .first()
      .boundingBox();
    expect(box?.height ?? 0, String(name)).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0, String(name)).toBeGreaterThanOrEqual(44);
  }
}

test("a price changed during Checkout is shown before booking", async ({ page }) => {
  // ground/m: no other test reads or changes it.
  const setPrice = (price: number) =>
    admin
      .from("price_list")
      .update({ price_iqd: price })
      .eq("tank_type", "ground")
      .eq("size", "m")
      .throwOnError();
  await setPrice(80000);
  slot = await createSlot();
  try {
    await signUp(page);
    await page.goto("/book");
    await page.getByRole("button", { name: `${Booking.edit} خزان سطح · 1,000–2,000` }).click();
    const sheet = page.getByRole("dialog", { name: Booking.editTitle });
    await sheet.getByText(Tanks.types.ground).click();
    await sheet.getByRole("button", { name: Booking.editSave }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("80,000 د.ع").filter({ visible: true }).first()).toBeVisible();
    await pickSlot(page, baghdadDate(1), slot.label);
    await page.getByRole("link", { name: Booking.next }).click();
    // Step 2's link has the same name as step 1's: wait for step 2 first.
    await expect(page).toHaveURL("/book/photos");
    await expect(page.getByRole("heading", { name: Upload.title })).toBeVisible();
    await page.getByRole("link", { name: Upload.next }).click();
    await expect(page).toHaveURL("/book/confirm");

    // An admin raises the price while the customer reads the summary.
    await setPrice(85000);
    await page.getByRole("button", { name: Checkout.confirm }).click();
    await expect(page.getByText(Checkout.errors.priceChanged)).toBeVisible();
    await expect(page.getByText("85,000 د.ع").filter({ visible: true }).first()).toBeVisible();
    await page.getByRole("button", { name: Checkout.confirm }).click();
    await page.waitForURL(/\/book\/done\//);
    const { data: order } = await admin
      .from("orders")
      .select("total_iqd")
      .eq("id", page.url().split("/").pop()!)
      .single()
      .throwOnError();
    expect(order.total_iqd).toBe(85000);
  } finally {
    await setPrice(80000);
  }
});

test("a guest opening Book logs in and comes back", async ({ page }) => {
  const phone = await signUp(page);
  await page.context().clearCookies();
  await skipSendLimits(phone);

  await page.goto("/book");
  await expect(page).toHaveURL("/login?next=%2Fbook");
  await requestCode(page, phone, "/login?next=%2Fbook");
  await enterCode(page, phone);
  await expect(page).toHaveURL("/book");
  await expect(page.getByRole("heading", { name: Booking.title })).toBeVisible();
});

test("without an address, Book asks for one first", async ({ page }) => {
  await signUp(page, { address: false });
  await page.goto("/book");
  await expect(page.getByRole("heading", { name: Booking.noAddressTitle })).toBeVisible();
  await expect(page.getByRole("link", { name: Booking.noAddressCta })).toHaveAttribute(
    "href",
    "/addresses/new?next=%2Fbook",
  );
});

test("books two tank lines with a photo and a video, then shows N5", async ({ page }) => {
  slot = await createSlot();
  const date = baghdadDate(1);
  const phone = await signUp(page);

  // Step 1.
  await page.goto("/book");
  await expect(page.getByRole("heading", { name: Booking.title })).toBeVisible();
  await expect(page.getByText(Booking.step)).toBeVisible();
  await expect(page.getByText("البيت · حي الحسين")).toBeVisible();
  // A first booking starts with the design's tank.
  await expect(
    page.getByRole("button", { name: `${Booking.edit} خزان سطح · 1,000–2,000` }),
  ).toBeVisible();
  await expect(page.getByText("35,000 د.ع")).toBeVisible();
  await expect(page.getByRole("button", { name: Booking.next })).toBeDisabled();
  await screenshot(page, "booking");

  await page.getByRole("button", { name: Booking.addTank }).click();
  const sheet = page.getByRole("dialog", { name: Booking.addTitle });
  await sheet.getByText(Tanks.types.ground).click();
  await sheet.getByText(Tanks.sizes.l).click();
  await sheet.getByRole("button", { name: messages.UI.increase }).click();
  await sheet.getByRole("button", { name: Booking.addSave }).click();
  await expect(sheet).toBeHidden();
  // 35,000 + 2 × 120,000.
  await expect(page.getByText("275,000 د.ع")).toBeVisible();

  await pickSlot(page, date, slot.label);
  await expectTouchTargets(page, [Booking.addTank, messages.UI.increase, messages.UI.decrease]);
  await page.getByRole("link", { name: Booking.next }).click();

  // Step 2.
  await expect(page).toHaveURL("/book/photos");
  await expect(page.getByRole("heading", { name: Upload.title })).toBeVisible();
  for (const [button, file] of [
    [Upload.fromGallery, "tank.jpg"],
    [Upload.recordVideo, "tank-5s.webm"],
  ] as const) {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: button }).click();
    await (await chooser).setFiles(fixture(file));
  }
  const files = page.getByRole("list", { name: Upload.filesLabel });
  await expect(files.getByText(Upload.uploaded)).toHaveCount(2, { timeout: 20_000 });
  await expect(files.getByText("صورة 1")).toBeVisible();
  await expect(files.getByText("فيديو 1")).toBeVisible();
  await expect(files.getByText("0:05")).toBeVisible();
  await page.getByLabel(Upload.noteLabel).fill("  الدرج ضيق  ");
  await screenshot(page, "upload");
  await page.getByRole("link", { name: Upload.next }).click();

  // Step 3.
  await expect(page).toHaveURL("/book/confirm");
  const summary = page.getByRole("definition");
  await expect(summary.filter({ hasText: "3 خزانات" })).toHaveCount(1);
  await expect(summary.filter({ hasText: slot.label })).toHaveCount(1);
  await expect(summary.filter({ hasText: "1 فيديو · 1 صورة" })).toHaveCount(1);
  await expect(
    page.getByRole("radio", { name: new RegExp(`^${Checkout.payments.cash}`) }),
  ).toBeChecked();
  await expect(
    page.getByRole("radio", { name: new RegExp(Checkout.payments.zain) }),
  ).toBeDisabled();
  await expect(page.getByText(Checkout.footer)).toBeVisible();
  // Next keeps step 1 alive (hidden), with the same total.
  await expect(page.getByText("275,000 د.ع").filter({ visible: true })).toBeVisible();
  await screenshot(page, "checkout");
  await page.getByRole("button", { name: Checkout.confirm }).click();

  // N5.
  await page.waitForURL(/\/book\/done\//);
  const orderId = page.url().split("/").pop()!;
  const { data: order } = await admin
    .from("orders")
    .select(
      "number, status, total_iqd, customer_note, slot_id, service_date, order_items(tank_type, size, qty), order_media(kind, media_type, duration_s)",
    )
    .eq("id", orderId)
    .single()
    .throwOnError();
  await expect(page.getByRole("heading", { name: `وصلنا طلبك #${order.number}` })).toBeVisible();
  await expect(page.getByText(BookingDone.status)).toBeVisible();
  await expect(page.getByRole("link", { name: BookingDone.details })).toHaveAttribute(
    "href",
    `/orders/${orderId}`,
  );
  await screenshot(page, "booking-done");

  expect(order).toMatchObject({
    status: "pending_confirmation",
    total_iqd: 275000,
    customer_note: "الدرج ضيق",
    slot_id: slot.id,
    service_date: date,
  });
  expect(order.order_items).toHaveLength(2);
  expect(order.order_media.map((m) => m.media_type).sort()).toEqual(["photo", "video"]);
  expect(order.order_media.find((m) => m.media_type === "video")?.duration_s).toBe(5);

  // The new tanks were saved to the address, and the next booking starts fresh with them.
  await page.getByRole("link", { name: BookingDone.home }).click();
  await page.goto("/book");
  await expect(page.getByRole("button", { name: /اختار خزان أرضي/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByText(Booking.noLines)).toBeVisible();
  const { count } = await admin
    .from("tanks")
    .select("*", { count: "exact", head: true })
    .eq("user_id", await userIdFor(phone));
  expect(count).toBe(2);
});

test("a slot taken while on Checkout sends the customer back to pick another", async ({ page }) => {
  slot = await createSlot(1);
  const date = baghdadDate(2);
  const phone = await signUp(page);

  await page.goto("/book");
  await pickSlot(page, date, slot.label);
  await page.getByRole("link", { name: Booking.next }).click();
  await page.getByRole("link", { name: Upload.skip }).click();
  await expect(page).toHaveURL("/book/confirm");

  await fillSlot(slot, date, phone);
  await page.getByRole("button", { name: Checkout.confirm }).click();

  await expect(page).toHaveURL("/book");
  // Next's route announcer is an alert too.
  await expect(
    page.getByRole("alert").filter({ hasText: Booking.errors.slotFull, visible: true }),
  ).toBeVisible();
  const taken = page.getByRole("radio", { name: new RegExp(slot.label) });
  await expect(taken).toBeDisabled();
  await expect(taken).not.toBeChecked();
  await expect(page.getByRole("button", { name: Booking.next })).toBeDisabled();
});

test("Upload refuses a video over a minute and removes a file", async ({ page }) => {
  slot = await createSlot();
  const phone = await signUp(page);
  await page.goto("/book");
  await pickSlot(page, baghdadDate(3), slot.label);
  await page.getByRole("link", { name: Booking.next }).click();

  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: Upload.fromGallery }).click();
  await (await chooser).setFiles(fixture("tank-65s.webm"));
  await expect(page.getByText(Upload.errors.tooLong)).toBeVisible();
  await expect(page.getByRole("list", { name: Upload.filesLabel })).toHaveCount(0);

  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: Upload.fromGallery }).click();
  await (await chooser).setFiles(fixture("tank.jpg"));
  await expect(page.getByText(Upload.uploaded)).toBeVisible({ timeout: 20_000 });
  await expectTouchTargets(page, [`احذف صورة 1`]);
  await page.getByRole("button", { name: "احذف صورة 1" }).click();
  await expect(page.getByRole("list", { name: Upload.filesLabel })).toHaveCount(0);
  // The finished upload is deleted from Storage too.
  const folder = `customer/${await userIdFor(phone)}`;
  await expect
    .poll(async () => (await admin.storage.from("order-media").list(folder)).data?.length)
    .toBe(0);

  await page.getByRole("link", { name: Upload.next }).click();
  await expect(page.getByRole("definition").filter({ hasText: Checkout.filesNone })).toHaveCount(1);
});

test("the booking steps can't be skipped", async ({ page }) => {
  await signUp(page);
  await page.goto("/book/confirm");
  await expect(page).toHaveURL("/book");
  await page.goto("/book/photos");
  await expect(page).toHaveURL("/book");
});

test("a reload keeps the booking's choices and finished uploads", async ({ page }) => {
  slot = await createSlot();
  const date = baghdadDate(4);
  await signUp(page);
  await page.goto("/book");
  await pickSlot(page, date, slot.label);
  await page.getByRole("link", { name: Booking.next }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: Upload.fromGallery }).click();
  await (await chooser).setFiles(fixture("tank.jpg"));
  await expect(page.getByText(Upload.uploaded)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(Upload.noteLabel).fill("قرب الباب");

  await page.reload();
  await expect(page.getByText(Upload.uploaded)).toBeVisible();
  await expect(page.getByLabel(Upload.noteLabel)).toHaveValue("قرب الباب");
  await page.goto("/book");
  await expect(page.getByRole("radio", { name: new RegExp(slot.label) })).toBeChecked();
});

test("an upload too old to book is forgotten, so the customer adds it again", async ({ page }) => {
  // create_order() takes uploads only within 48 h (spec §7 Storage); the app
  // forgets them at 46 h by the device's clock.
  slot = await createSlot();
  const date = baghdadDate(4);
  const phone = await signUp(page);
  const userId = await userIdFor(phone);
  await page.goto("/book");
  await pickSlot(page, date, slot.label);
  await page.getByRole("link", { name: Booking.next }).click();
  const files = page.getByRole("list", { name: Upload.filesLabel });
  for (let i = 0; i < 2; i++) {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: Upload.fromGallery }).click();
    await (await chooser).setFiles(fixture("tank.jpg"));
  }
  await expect(files.getByText(Upload.uploaded)).toHaveCount(2, { timeout: 20_000 });

  // Saved 47 h ago (a tab left open), and the tab reloads on Checkout: the
  // file is forgotten, and confirming says so instead of booking without it.
  await page.evaluate((key) => {
    const saved = JSON.parse(window.sessionStorage.getItem(key) ?? "[]") as Array<{
      uploadedAt: number;
    }>;
    saved[0]!.uploadedAt = Date.now() - 47 * 60 * 60 * 1000;
    window.sessionStorage.setItem(key, JSON.stringify(saved));
  }, `zl_booking_files:${userId}`);
  await page.getByRole("link", { name: Upload.next }).click();
  await expect(page).toHaveURL("/book/confirm");
  await page.reload();
  await page.getByRole("button", { name: Checkout.confirm }).click();
  await expect(page.getByText(Checkout.errors.uploadMissing)).toBeVisible();
  await page.getByRole("link", { name: Checkout.backToPhotos }).click();
  await expect(page).toHaveURL("/book/photos");
  await expect(files.filter({ visible: true }).getByText(Upload.uploaded)).toHaveCount(1);

  // Still open on Checkout 47 h later: confirming forgets the other one too.
  await page.getByRole("link", { name: Upload.next }).click();
  await expect(page).toHaveURL("/book/confirm");
  await page.clock.setSystemTime(Date.now() + 47 * 60 * 60 * 1000);
  await page.getByRole("button", { name: Checkout.confirm }).click();
  await expect(
    page.getByText(Checkout.errors.uploadMissing).filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: Checkout.backToPhotos }).filter({ visible: true }).click();
  await expect(page).toHaveURL("/book/photos");
  // Next keeps the earlier Photos alive (hidden), with its list.
  await expect(
    page.getByRole("list", { name: Upload.filesLabel }).filter({ visible: true }),
  ).toHaveCount(0);
});
