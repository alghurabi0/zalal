import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { type Browser, expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCrew, createCustomer, logInAsAdmin, logInAsCrew } from "./helpers/admin";
import { screenshot, signUp } from "./helpers/auth";
import {
  baghdadDate,
  createOrder,
  createSlot,
  disableSlot,
  type TestSlot,
} from "./helpers/booking";
import { admin } from "./helpers/supabase";
import { distanceKm, distanceParts } from "../../src/lib/live/tracking";

// The live job (spec §5.13 Tracking, §5.14 Job progress, §8.1 GPS sharing,
// §8.2 A3): the crew phone shares its position on the way, the customer
// tracks it live, then follows the crew's photos and clips.

const { Tracking, LiveJob, Crew, Orders, Order, Admin } = messages;

let slot: TestSlot | null = null;
test.afterEach(async () => {
  if (slot) await disableSlot(slot.id);
  slot = null;
});

const visible = (page: Page) => page.locator("main").filter({ visible: true });

/** A logged-in crew on its own phone, with GPS at `at`. */
async function crewPhone(browser: Browser, at: { latitude: number; longitude: number }) {
  const context = await browser.newContext({
    geolocation: at,
    permissions: ["geolocation"],
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const crew = await logInAsCrew(page);
  return { context, page, crew };
}

async function setCompanyPhone() {
  await admin
    .from("settings")
    .update({ company_phone: "+9647801234567" })
    .eq("id", true)
    .throwOnError();
}

test("the crew shares its position on the way and the customer tracks it live", async ({
  page,
  browser,
}) => {
  slot = await createSlot();
  await setCompanyPhone();
  const phone = await signUp(page);
  // About 3 km north-east of the customer's pin.
  const crewSide = await crewPhone(browser, { latitude: 32.6365, longitude: 44.0555 });
  const order = await createOrder(phone, {
    slot,
    date: baghdadDate(0),
    status: "confirmed",
    crewId: crewSide.crew.id,
  });

  // Before the crew sets off, Tracking isn't open: Order details instead.
  await page.goto(`/orders/${order.id}/track`);
  await page.waitForURL(`**/orders/${order.id}`);

  // The crew sets off: its phone starts sharing and asks to stay open.
  const job = crewSide.page;
  await job.goto(`/crew/jobs/${order.id}`);
  await job.getByRole("button", { name: Crew.steps.leave }).click();
  await expect(job.getByText(Crew.location.keepOpen)).toBeVisible();
  await expect(job.getByText(Crew.location.state.sharing)).toBeVisible();
  const { data: shared } = await admin
    .from("crew_live_location")
    .select("lat, lng, crew_id")
    .eq("order_id", order.id)
    .single()
    .throwOnError();
  expect(shared).toEqual({ lat: 32.6365, lng: 44.0555, crew_id: crewSide.crew.id });

  // Orders offers تتبّع الفريق, which opens Tracking.
  await page.goto("/orders");
  await visible(page).getByRole("link", { name: Orders.track }).click();
  await page.waitForURL(`**/orders/${order.id}/track`);
  const main = visible(page);
  await expect(main.getByRole("heading", { name: Tracking.title })).toBeAttached();
  await expect(main.getByText(Tracking.live)).toBeVisible();
  const { data: home } = await admin
    .from("orders")
    .select("lat, lng")
    .eq("id", order.id)
    .single()
    .throwOnError();
  const shown = (lat: number, lng: number) => {
    const { unit, value } = distanceParts(distanceKm(home, { lat, lng }));
    return Tracking[unit].replace("{value}", value);
  };
  expect(shown(32.6365, 44.0555)).toMatch(/^3\.\d كم$/);
  await expect(main.getByTestId("distance")).toHaveText(shown(32.6365, 44.0555));
  await expect(main.getByTestId("updated")).toBeVisible();
  await expect(main.getByTestId("crew-pin")).toBeVisible();
  const steps = main.getByRole("list", { name: Tracking.steps.label }).getByRole("listitem");
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(0)).toHaveAttribute("data-state", "done");
  await expect(steps.nth(1)).toHaveAttribute("data-state", "now");
  await expect(main.getByRole("link", { name: Tracking.call })).toHaveAttribute(
    "href",
    "tel:+9647801234567",
  );
  await expect(main.getByRole("button", { name: Tracking.followLater })).toBeDisabled();
  for (const control of [
    main.getByRole("link", { name: messages.UI.back }),
    main.getByRole("link", { name: Tracking.call }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  await screenshot(page, "tracking");

  // A newer position arrives through Realtime, without a reload.
  await admin
    .from("crew_live_location")
    .update({ lat: home.lat + 0.005, lng: home.lng })
    .eq("order_id", order.id)
    .throwOnError();
  // 0.005° of latitude is about 560 m.
  expect(shown(home.lat + 0.005, home.lng)).toBe("560 متر");
  await expect(main.getByTestId("distance")).toHaveText("560 متر");

  // The crew arrives: sharing stops, and Tracking turns to Job progress.
  await job.getByRole("button", { name: Crew.steps.arrive }).click();
  await expect(job.getByText(Crew.location.keepOpen)).toHaveCount(0);
  await expect(main.getByText(Tracking.arrivedLabel)).toBeVisible();
  await expect(main.getByText(Tracking.live)).toHaveCount(0);
  await expect(main.getByRole("link", { name: Tracking.follow })).toHaveAttribute(
    "href",
    `/orders/${order.id}/live`,
  );
  await crewSide.context.close();
});

test("Tracking says when the crew's position stops updating", async ({ page }) => {
  slot = await createSlot();
  const phone = await signUp(page);
  const crew = await createCrew();
  const order = await createOrder(phone, {
    slot,
    date: baghdadDate(0),
    status: "on_the_way",
    crewId: crew.id,
  });

  // No position yet.
  await page.goto(`/orders/${order.id}/track`);
  const main = visible(page);
  await expect(main.getByText(Tracking.waiting)).toBeVisible();
  await expect(main.getByTestId("crew-pin")).toHaveCount(0);

  // A position from 3 minutes ago.
  await admin
    .from("crew_live_location")
    .insert({
      order_id: order.id,
      crew_id: crew.id,
      lat: 32.62,
      lng: 44.04,
      accuracy_m: 20,
      updated_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    })
    .throwOnError();
  await page.reload();
  await expect(main.getByText(Tracking.stale)).toBeVisible();
  await expect(main.getByTestId("updated")).toHaveText("آخر تحديث قبل 3 دقائق");

  // Order details links here while the crew is on the way.
  await page.goto(`/orders/${order.id}`);
  await expect(visible(page).getByRole("link", { name: Order.track })).toHaveAttribute(
    "href",
    `/orders/${order.id}/track`,
  );
});

/** A crew file in Storage and attached to the order, as attach_job_media leaves it. */
async function attach(
  orderId: string,
  crewId: string,
  kind: "before" | "after" | "clip",
  file: "tank.jpg" | "tank-5s.webm",
) {
  const path = `crew/${crewId}/${orderId}/${randomUUID()}.${file.split(".").pop()}`;
  const body = readFileSync(new URL(`./fixtures/${file}`, import.meta.url));
  const contentType = file.endsWith(".jpg") ? "image/jpeg" : "video/webm";
  await admin.storage.from("order-media").upload(path, body, { contentType });
  await admin
    .from("order_media")
    .insert({
      order_id: orderId,
      kind,
      media_type: kind === "clip" ? "video" : "photo",
      path,
      bytes: body.length,
      duration_s: kind === "clip" ? 5 : null,
    })
    .throwOnError();
  return path;
}

async function moveTo(
  orderId: string,
  from: "arrived" | "in_progress",
  to: "in_progress" | "completed",
) {
  await admin
    .from("order_events")
    .insert({ order_id: orderId, from_status: from, to_status: to, actor_role: "crew" })
    .throwOnError();
  await admin.from("orders").update({ status: to }).eq("id", orderId).throwOnError();
}

test("Job progress shows the steps and the crew's photos and clips as they arrive", async ({
  page,
}) => {
  slot = await createSlot();
  const phone = await signUp(page);
  const crew = await createCrew();
  const order = await createOrder(phone, {
    slot,
    date: baghdadDate(0),
    status: "arrived",
    crewId: crew.id,
  });
  const paths: string[] = [];

  // Orders offers تابع الشغل from arrival.
  await page.goto("/orders");
  await visible(page).getByRole("link", { name: Orders.progress }).click();
  await page.waitForURL(`**/orders/${order.id}/live`);
  const main = visible(page);
  await expect(main.getByRole("heading", { name: LiveJob.title })).toBeVisible();
  const steps = main.getByRole("list", { name: LiveJob.steps.label }).getByRole("listitem");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toHaveAttribute("data-state", "done");
  await expect(steps.nth(1)).toHaveAttribute("data-state", "next");
  await expect(main.getByText(LiveJob.live, { exact: true })).toHaveCount(0);
  await expect(main.getByTestId("no-files")).toHaveText(LiveJob.noFilesOpen);
  await expect(main.getByRole("button", { name: LiveJob.certificateLater })).toBeDisabled();

  // A before photo arrives without a reload.
  paths.push(await attach(order.id, crew.id, "before", "tank.jpg"));
  await expect(main.getByRole("heading", { name: LiveJob.before })).toBeVisible();
  await expect(main.getByRole("button", { name: /صورة 1/ })).toBeVisible();

  // Work starts: the badge, the step in progress, a clip and an after photo.
  await moveTo(order.id, "arrived", "in_progress");
  await expect(main.getByText(LiveJob.live, { exact: true })).toBeVisible();
  await expect(steps.nth(1)).toHaveAttribute("data-state", "now");
  paths.push(await attach(order.id, crew.id, "clip", "tank-5s.webm"));
  paths.push(await attach(order.id, crew.id, "after", "tank.jpg"));
  await expect(main.getByRole("heading", { name: LiveJob.clips })).toBeVisible();
  await expect(main.getByRole("heading", { name: LiveJob.after })).toBeVisible();
  await expect(main.locator("video")).toHaveCount(1);
  await expect(main.getByText("0:05")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await screenshot(page, "live-job");

  // The photo opens full screen and closes again.
  await main.getByRole("button", { name: /صورة 1/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img")).toBeVisible();
  const close = dialog.getByRole("button", { name: messages.UI.close });
  const box = await close.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  await close.click();
  await expect(dialog).toHaveCount(0);

  // Done: no badge, and the button opens Order details until certificates exist.
  await moveTo(order.id, "in_progress", "completed");
  await expect(main.getByText(LiveJob.live, { exact: true })).toHaveCount(0);
  await expect(steps.nth(2)).toHaveAttribute("data-state", "done");
  await expect(main.getByRole("link", { name: LiveJob.details })).toHaveAttribute(
    "href",
    `/orders/${order.id}`,
  );

  await admin.storage.from("order-media").remove(paths);
});

test("Job progress and Tracking send other statuses to the right screen", async ({ page }) => {
  slot = await createSlot();
  const phone = await signUp(page);
  const confirmed = await createOrder(phone, { slot, date: baghdadDate(1), status: "confirmed" });
  const onTheWay = await createOrder(phone, { slot, date: baghdadDate(0), status: "on_the_way" });
  const completed = await createOrder(phone, { slot, date: baghdadDate(0), status: "completed" });

  await page.goto(`/orders/${confirmed.id}/live`);
  await page.waitForURL(`**/orders/${confirmed.id}`);
  await page.goto(`/orders/${onTheWay.id}/live`);
  await page.waitForURL(`**/orders/${onTheWay.id}/track`);
  await page.goto(`/orders/${completed.id}/track`);
  await page.waitForURL(`**/orders/${completed.id}/live`);
  await expect(visible(page).getByTestId("no-files")).toHaveText(LiveJob.noFilesDone);

  // Someone else's order, or no order at all.
  await page.goto(`/orders/${randomUUID()}/track`);
  await expect(visible(page).getByRole("heading", { name: Order.notFound })).toBeVisible();
  await page.goto("/orders/not-an-id/live");
  await expect(visible(page).getByRole("heading", { name: Order.notFound })).toBeVisible();
});

test.describe("admin live map", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("lists the crews on the way with their orders, and follows their positions", async ({
    page,
  }) => {
    slot = await createSlot();
    const customer = await createCustomer();
    const crew = await createCrew();
    const waiting = await createCrew();
    const order = await createOrder(customer.phone, {
      slot,
      date: baghdadDate(0),
      status: "on_the_way",
      crewId: crew.id,
    });
    const noPosition = await createOrder(customer.phone, {
      slot,
      date: baghdadDate(0),
      status: "on_the_way",
      crewId: waiting.id,
    });
    const confirmed = await createOrder(customer.phone, {
      slot,
      date: baghdadDate(0),
      status: "confirmed",
      crewId: crew.id,
    });
    // createCustomer's pin is 32.616, 44.024; the crew is 0.01° north (about 1.1 km).
    await admin
      .from("crew_live_location")
      .insert({ order_id: order.id, crew_id: crew.id, lat: 32.626, lng: 44.024, accuracy_m: 9 })
      .throwOnError();

    await logInAsAdmin(page);
    await page.getByRole("navigation").getByRole("link", { name: Admin.nav.live }).first().click();
    await page.waitForURL("**/admin/live");
    await expect(page.getByRole("heading", { name: Admin.liveMap.title })).toBeVisible();
    await expect(page.getByRole("img", { name: Admin.liveMap.map })).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: `#${order.number}` });
    await expect(row).toContainText(crew.name);
    await expect(row).toContainText(customer.district);
    await expect(row.getByTestId("distance")).toHaveText("1.1 كم");
    await expect(row.getByRole("link", { name: `#${order.number}` })).toHaveAttribute(
      "href",
      `/admin/orders?order=${order.id}`,
    );
    await expect(
      page.getByRole("row").filter({ hasText: `#${noPosition.number}` }),
    ).toContainText(Admin.liveMap.noPosition);
    await expect(page.getByRole("row").filter({ hasText: `#${confirmed.number}` })).toHaveCount(0);
    await screenshot(page, "admin-live");

    // The crew moves: the new position arrives without a reload.
    await admin
      .from("crew_live_location")
      .update({ lat: 32.62, lng: 44.024 })
      .eq("order_id", order.id)
      .throwOnError();
    await expect(row.getByTestId("distance")).toHaveText("440 متر");

    // It arrives: the shell reloads the page and the job leaves the map.
    await admin.from("orders").update({ status: "arrived" }).eq("id", order.id).throwOnError();
    await expect(page.getByRole("row").filter({ hasText: `#${order.number}` })).toHaveCount(0);
  });
});
