import { readFile } from "node:fs/promises";

import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCustomer, logInAsAdmin } from "./helpers/admin";
import { screenshot } from "./helpers/auth";
import { baghdadDate, createOrder, disableSlot, type TestSlot } from "./helpers/booking";
import { admin } from "./helpers/supabase";

// Admin dashboard, part B (spec §8.2): Prices (A8), Schedule (A9) and
// Settings with the service-area editor (A13), on the keyless path. Tests
// share one local database with parallel tests, so each changes only values
// no other test reads (a price no booking test uses, its own slot, a day
// outside the booking window, sterilant_text, a new switched-off area) and
// puts back what it changed.

const { Admin, Tanks } = messages;
const { prices: Prices, schedule: Schedule, settings: Settings, area: Area } = Admin;

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

async function lastAudit(action: string) {
  const { data } = await admin
    .from("admin_audit_log")
    .select("entity_id, diff, created_at")
    .eq("action", action)
    .order("created_at", { ascending: false })
    .limit(1)
    .single()
    .throwOnError();
  return data;
}

test("the admin nav reaches Prices, Schedule and Settings", async ({ page }) => {
  await logInAsAdmin(page);
  const nav = page.getByRole("navigation", { name: Admin.nav.label });
  for (const [name, url, heading] of [
    [Admin.nav.prices, "/admin/prices", Prices.title],
    [Admin.nav.schedule, "/admin/schedule", Schedule.title],
    [Admin.nav.settings, "/admin/settings", Settings.title],
  ] as const) {
    await nav.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
});

test.describe("prices", () => {
  // No booking or order test uses roof/l (the Checkout price test uses ground/m).
  const restore = () =>
    admin
      .from("price_list")
      .update({ price_iqd: 50000 })
      .eq("tank_type", "roof")
      .eq("size", "l")
      .throwOnError();
  test.afterEach(restore);

  test("an admin changes a price and it is audited", async ({ page }) => {
    await restore();
    await logInAsAdmin(page);
    await page.goto("/admin/prices");
    const cell = page.getByLabel(
      Prices.cellLabel.replace("{type}", Tanks.types.roof).replace("{size}", Tanks.sizes.l),
    );
    await expect(cell).toHaveValue("50000");
    await screenshot(page, "admin-prices");

    await cell.fill("abc");
    await expect(page.getByRole("button", { name: Prices.save })).toBeDisabled();
    await cell.fill("52,500");
    await expect(page.getByText("52,500 د.ع")).toBeVisible();
    await page.getByRole("button", { name: Prices.save }).click();
    await expect(page.getByRole("status").getByText(Prices.saved, { exact: true })).toBeVisible();

    const { data } = await admin
      .from("price_list")
      .select("price_iqd")
      .eq("tank_type", "roof")
      .eq("size", "l")
      .single()
      .throwOnError();
    expect(data.price_iqd).toBe(52500);
    const audit = await lastAudit("price.update");
    expect(audit.entity_id).toBe("roof/l");
    expect(audit.diff).toEqual({ from: 50000, to: 52500 });
  });
});

/** A free evening time (20:01–22:59 start) no other slot has, an hour long. */
async function freeSlotTimes(): Promise<{ start: string; end: string }> {
  const { data } = await admin.from("slots").select("start_time, end_time").throwOnError();
  const taken = new Set(data.map((s) => `${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}`));
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let attempt = 0; attempt < 50; attempt++) {
    const hour = 20 + Math.floor(Math.random() * 3);
    const minute = 1 + Math.floor(Math.random() * 59);
    const start = `${pad(hour)}:${pad(minute)}`;
    const end = `${pad(hour + 1)}:${pad(minute)}`;
    if (!taken.has(`${start}-${end}`)) return { start, end };
  }
  throw new Error("No free slot time");
}

test.describe("schedule", () => {
  let slotId: number | null = null;
  test.afterEach(async () => {
    if (slotId) await disableSlot(slotId);
    slotId = null;
  });

  test("an admin adds a slot, lowers its capacity and switches it off", async ({ page }) => {
    const { start, end } = await freeSlotTimes();
    await logInAsAdmin(page);
    await page.goto("/admin/schedule");
    await expect(page.getByRole("heading", { name: Schedule.slotsTitle })).toBeVisible();

    await page.getByRole("button", { name: Schedule.add }).click();
    const form = page.getByRole("form", { name: Schedule.addTitle });
    await form.getByLabel(Schedule.start).fill(start);
    await form.getByLabel(Schedule.end).fill(end);
    await form.getByLabel(Schedule.capacity).fill("2");
    // Friday too: every day.
    await form.getByText(Admin.weekdays["5"]).click();
    await form.getByRole("button", { name: Schedule.create }).click();
    await expect(form).toBeHidden();

    const row = page.getByTestId(`slot-${start}-${end}`);
    await expect(row).toBeVisible();
    await expect(row.getByText(Schedule.everyDay)).toBeVisible();
    const { data: created } = await admin
      .from("slots")
      .select("id, capacity, weekdays, active")
      .eq("start_time", start)
      .eq("end_time", end)
      .single()
      .throwOnError();
    slotId = created.id;
    expect(created).toMatchObject({ capacity: 2, weekdays: [0, 1, 2, 3, 4, 5, 6], active: true });
    expect((await lastAudit("slot.create")).entity_id).toBe(String(created.id));

    // Adding the same times again is refused.
    await page.getByRole("button", { name: Schedule.add }).click();
    const again = page.getByRole("form", { name: Schedule.addTitle });
    await again.getByLabel(Schedule.start).fill(start);
    await again.getByLabel(Schedule.end).fill(end);
    await again.getByRole("button", { name: Schedule.create }).click();
    await expect(again.getByText(Admin.editErrors.slot_exists)).toBeVisible();
    await again.getByRole("button", { name: Schedule.cancel }).click();

    // Two orders in it on day 3, then capacity 1: the second one no longer fits.
    const slot: TestSlot = { id: created.id, label: "", startTime: start, endTime: end };
    const date = baghdadDate(3);
    const { phone: first } = await createCustomer();
    const { phone: second } = await createCustomer();
    await createOrder(first, { slot, date, status: "confirmed" });
    const late = await createOrder(second, { slot, date });
    await page.reload();

    await row.getByRole("button", { name: Schedule.edit }).click();
    const edit = page.getByRole("form", { name: /^تعديل موعد/ });
    await expect(edit.getByText(/طلبات محجوزة من اليوم/)).toBeVisible();
    await edit.getByLabel(Schedule.capacity).fill("1");
    await edit.getByRole("button", { name: Schedule.save }).click();
    await expect(edit).toBeHidden();

    const conflicts = page.getByRole("table", { name: Schedule.conflictsCaption });
    const conflict = conflicts.getByRole("row").filter({ hasText: `#${late.number}` });
    await expect(conflict.getByText(Schedule.reasons.over_capacity)).toBeVisible();
    await expect(conflict.getByRole("link", { name: `#${late.number}` })).toHaveAttribute(
      "href",
      `/admin/orders?order=${late.id}`,
    );
    await screenshot(page, "admin-schedule");

    // Switched off: both orders keep their places and are listed.
    await row.getByRole("button", { name: Schedule.edit }).click();
    await page
      .getByRole("form", { name: /^تعديل موعد/ })
      .getByLabel(Schedule.activeLabel)
      .uncheck();
    await page
      .getByRole("form", { name: /^تعديل موعد/ })
      .getByRole("button", { name: Schedule.save })
      .click();
    await expect(row.getByText(Schedule.inactive)).toBeVisible();
    await expect(
      conflicts
        .getByRole("row")
        .filter({ hasText: `#${late.number}` })
        .getByText(Schedule.reasons.slot_off),
    ).toBeVisible();
    const { count } = await admin
      .from("slot_bookings")
      .select("order_id", { count: "exact", head: true })
      .eq("slot_id", created.id);
    expect(count).toBe(2);
    const update = await lastAudit("slot.update");
    expect(update.diff).toEqual({ active: { from: true, to: false } });
  });

  test("an admin blocks a day and opens it again", async ({ page }) => {
    // Past the booking window, so no booking test meets it.
    const date = baghdadDate(45);
    await admin.from("blocked_dates").delete().eq("date", date).throwOnError();
    await logInAsAdmin(page);
    await page.goto(`/admin/schedule?month=${date.slice(0, 7)}`);

    await page.locator(`[data-date="${date}"]`).click();
    await page.getByLabel(Schedule.reason).fill("عطلة التجربة");
    await page.getByRole("button", { name: Schedule.block }).click();
    await expect(page.getByText(Schedule.blockedDone, { exact: true })).toBeVisible();
    await expect(page.locator(`[data-date="${date}"]`)).toHaveAccessibleName(/مسدود/);
    const { data } = await admin
      .from("blocked_dates")
      .select("reason")
      .eq("date", date)
      .single()
      .throwOnError();
    expect(data.reason).toBe("عطلة التجربة");
    await screenshot(page, "admin-schedule-blocked");

    await page.getByRole("button", { name: Schedule.unblock }).click();
    await expect(page.getByText(Schedule.unblockedDone, { exact: true })).toBeVisible();
    const { count } = await admin
      .from("blocked_dates")
      .select("date", { count: "exact", head: true })
      .eq("date", date);
    expect(count).toBe(0);
    expect((await lastAudit("blocked_date.remove")).entity_id).toBe(date);

    // A past day can't be blocked.
    await page.goto(`/admin/schedule?month=${baghdadDate(-1).slice(0, 7)}`);
    await page.locator(`[data-date="${baghdadDate(-1)}"]`).click();
    await expect(page.getByText(Schedule.pastDay)).toBeVisible();
    await expect(page.getByRole("button", { name: Schedule.block })).toHaveCount(0);
  });
});

test.describe("settings", () => {
  let sterilant: string | null = null;
  test.afterEach(async () => {
    if (sterilant !== null) {
      await admin
        .from("settings")
        .update({ sterilant_text: sterilant })
        .eq("id", true)
        .throwOnError();
    }
    sterilant = null;
  });

  test("an admin saves the sterilant for the crew form", async ({ page }) => {
    const { data } = await admin.from("settings").select("sterilant_text").single().throwOnError();
    sterilant = data.sterilant_text;
    await logInAsAdmin(page);
    await page.goto("/admin/settings");
    await screenshot(page, "admin-settings");

    const crew = page.getByRole("form", { name: Settings.crew.title });
    const value = `كلور تجربة ${Date.now() % 10000}`;
    await crew.getByLabel(Settings.crew.sterilant).fill(value);
    await crew.getByRole("button", { name: Settings.save }).click();
    await expect(crew.getByText(Settings.saved, { exact: true })).toBeVisible();
    const { data: saved } = await admin
      .from("settings")
      .select("sterilant_text")
      .single()
      .throwOnError();
    expect(saved.sterilant_text).toBe(value);
    expect((await lastAudit("settings.update")).diff).toEqual({
      sterilant_text: { from: sterilant, to: value },
    });

    // A bad phone keeps the support section from saving.
    const support = page.getByRole("form", { name: Settings.support.title });
    await support.getByLabel(Settings.support.phone).fill("123");
    await expect(support.getByText(Settings.support.invalidPhone)).toBeVisible();
    await expect(support.getByRole("button", { name: Settings.save })).toBeDisabled();
  });
});

test.describe("service area", () => {
  /** Uploads GeoJSON through the editor's file input. */
  async function importGeoJson(page: Page, geometry: object) {
    await page.getByLabel(Area.importFile).setInputFiles({
      name: "area.geojson",
      mimeType: "application/geo+json",
      buffer: Buffer.from(JSON.stringify(geometry)),
    });
  }

  test("an admin imports an area, saves it switched off and exports it", async ({ page }) => {
    await logInAsAdmin(page);
    await page.goto("/admin/settings");
    await page.getByRole("link", { name: Settings.area.open }).click();
    await expect(page).toHaveURL("/admin/settings/area");
    await expect(page.getByRole("heading", { level: 1, name: Area.title })).toBeVisible();

    await page.getByRole("button", { name: Area.add }).click();
    const editor = page.getByRole("form", { name: Area.editorAdd });
    await expect(editor.getByText(Area.noShape)).toBeVisible();
    const name = `منطقة تجربة ${Date.now() % 100000}`;
    await editor.getByLabel(Area.name).fill(name);
    await editor.getByLabel(Area.activeLabel).uncheck();

    // Not GeoJSON, then a self-intersecting shape the database refuses.
    await page.getByRole("button", { name: Area.paste }).click();
    await editor.getByLabel(Area.pasteLabel).fill("{ not json");
    await editor.getByRole("button", { name: Area.usePasted }).click();
    await expect(editor.getByText(Area.importErrors.json)).toBeVisible();
    await importGeoJson(page, {
      type: "Polygon",
      coordinates: [
        [
          [44.2, 32.5],
          [44.3, 32.6],
          [44.3, 32.5],
          [44.2, 32.6],
          [44.2, 32.5],
        ],
      ],
    });
    await expect(editor.getByRole("img", { name: new RegExp(name) })).toBeVisible();
    await editor.getByRole("button", { name: Area.save }).click();
    await expect(editor.getByText(Admin.editErrors.invalid_area)).toBeVisible();

    // A box near Hindiya, as a Feature.
    const hindiya = [
      [
        [44.2, 32.5],
        [44.3, 32.5],
        [44.3, 32.6],
        [44.2, 32.6],
        [44.2, 32.5],
      ],
    ];
    await importGeoJson(page, {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: hindiya },
    });
    await expect(editor.getByLabel(Area.name)).toHaveValue(name);
    await screenshot(page, "admin-area");
    await editor.getByRole("button", { name: Area.save }).click();
    await expect(editor).toBeHidden();

    const { data: saved } = await admin
      .from("service_areas")
      .select("id, active")
      .eq("name", name)
      .single()
      .throwOnError();
    expect(saved.active).toBe(false);
    expect((await lastAudit("service_area.create")).entity_id).toBe(String(saved.id));
    const card = page.getByTestId(`area-${saved.id}`);
    await expect(card.getByText(Area.inactive)).toBeVisible();

    const download = page.waitForEvent("download");
    await card.getByRole("button", { name: Area.exportArea.replace("{name}", name) }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`service-area-${saved.id}.geojson`);
    const exported = JSON.parse(await readFile(await file.path(), "utf8")) as {
      features: {
        properties: { name: string };
        geometry: { type: string; coordinates: unknown };
      }[];
    };
    expect(exported.features[0]?.properties.name).toBe(name);
    expect(exported.features[0]?.geometry).toEqual({
      type: "MultiPolygon",
      coordinates: [hindiya],
    });
  });
});
