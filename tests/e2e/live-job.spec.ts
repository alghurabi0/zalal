import { type Browser, expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCrew, logInAsCrew } from "./helpers/admin";
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

const { Tracking, Crew, Orders, Order } = messages;

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
