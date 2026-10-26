import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { createCustomer, logInAsCrew } from "./helpers/admin";
import { screenshot } from "./helpers/auth";
import { baghdadDate, createOrder, createSlot } from "./helpers/booking";
import { admin } from "./helpers/supabase";

// The crew app, part B (spec §8.1 C3b, C4): before and after photos and
// clips from the camera, kept in a queue that survives no signal and a
// reload, and the full finish form.

const { Crew, Profile } = messages;
const fixture = (name: string) => path.resolve("tests/e2e/fixtures", name);
const plural = (one: string) => one.replace(/.*one \{([^}]*)\}.*/, "$1");
const TUS = "**/storage/v1/upload/resumable**";

async function openJob(page: Page, status: "arrived" | "in_progress", crewId: string) {
  const slot = await createSlot();
  const customer = await createCustomer();
  const order = await createOrder(customer.phone, {
    slot,
    date: baghdadDate(0),
    status,
    crewId,
  });
  await page.goto(`/crew/jobs/${order.id}`);
  return order;
}

function section(page: Page, kind: "before" | "after" | "clip") {
  return page.getByRole("region", { name: Crew.media.sections[kind] }).filter({ visible: true });
}

async function take(page: Page, kind: "before" | "after" | "clip", file: string) {
  const chooser = page.waitForEvent("filechooser");
  await section(page, kind).getByRole("button", { name: Crew.media.captureLabel[kind] }).click();
  await (await chooser).setFiles(fixture(file));
}

async function mediaOf(orderId: string) {
  const { data } = await admin
    .from("order_media")
    .select("id, kind, media_type, duration_s")
    .eq("order_id", orderId)
    .order("created_at")
    .throwOnError();
  return data;
}

/** How many files the queue holds on this phone (IndexedDB), any account. */
function queuedOnPhone(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("zl-crew-media", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("files", { keyPath: "id" });
        open.onsuccess = () => {
          const count = open.result.transaction("files").objectStore("files").count();
          count.onsuccess = () => {
            open.result.close();
            resolve(count.result);
          };
        };
      }),
  );
}

test("before and after photos and a clip go up from the camera", async ({ page }) => {
  const crew = await logInAsCrew(page);
  const order = await openJob(page, "arrived", crew.id);

  // Arrived: before photos only.
  await expect(section(page, "after")).toHaveCount(0);
  await take(page, "before", "tank.jpg");
  await expect(section(page, "before").getByRole("img", { name: "صورة 1" })).toBeVisible({
    timeout: 20_000,
  });
  expect(await mediaOf(order.id)).toMatchObject([{ kind: "before", media_type: "photo" }]);

  await page.getByRole("button", { name: Crew.steps.start }).click();
  await expect(section(page, "after")).toBeVisible();

  await take(page, "clip", "tank-65s.webm");
  await expect(section(page, "clip")).toContainText(Crew.media.problems.too_long);
  await take(page, "clip", "tank-5s.webm");
  await expect(section(page, "clip").locator("video[aria-label='مقطع 1']")).toBeVisible({
    timeout: 20_000,
  });

  await take(page, "after", "tank.jpg");
  await expect(section(page, "after").getByRole("img", { name: "صورة 1" })).toBeVisible({
    timeout: 20_000,
  });
  await section(page, "before").scrollIntoViewIfNeeded();
  await screenshot(page, "crew-job-media");

  const media = await mediaOf(order.id);
  expect(media.map((file) => file.kind).sort()).toEqual(["after", "before", "clip"]);
  expect(media.find((file) => file.kind === "clip")).toMatchObject({ media_type: "video" });

  // A wrong photo comes back off the job while work is under way.
  await section(page, "after")
    .getByRole("button", { name: Crew.media.remove.replace("{name}", "صورة 1") })
    .click();
  await expect(section(page, "after").getByRole("img")).toHaveCount(0);
  expect((await mediaOf(order.id)).map((file) => file.kind).sort()).toEqual(["before", "clip"]);
});

test("a photo taken without signal waits, survives a reload, then goes up", async ({
  page,
  context,
}) => {
  // Waits out TUS's own retries.
  test.slow();
  const crew = await logInAsCrew(page);
  const order = await openJob(page, "in_progress", crew.id);

  // Storage can't be reached: the file stays queued on the phone.
  await page.route(TUS, (route) => route.abort("internetdisconnected"));
  await take(page, "after", "tank.jpg");
  const row = section(page, "after").getByRole("listitem").filter({ hasText: "صورة 1" });
  // TUS tries a few times (about 20 s) before the queue waits for its next turn.
  await expect(row).toContainText(Crew.media.status.waiting, { timeout: 40_000 });
  await context.setOffline(true);
  await expect(page.getByText(Crew.media.offline)).toBeVisible();
  await expect(row).toContainText(Crew.media.status.offline);
  await context.setOffline(false);
  expect(await queuedOnPhone(page)).toBe(1);

  // My jobs says so too, and a reload keeps it.
  await page.goto("/crew");
  await expect(page.getByText(plural(Crew.queued)).filter({ visible: true })).toBeVisible();
  await page.goto(`/crew/jobs/${order.id}`);
  await expect(row).toBeVisible();
  expect(await mediaOf(order.id)).toEqual([]);

  // Signal again: it goes up by itself.
  await page.unroute(TUS);
  await context.setOffline(true);
  await context.setOffline(false);
  await expect(section(page, "after").getByRole("img", { name: "صورة 1" })).toBeVisible({
    timeout: 30_000,
  });
  expect(await mediaOf(order.id)).toMatchObject([{ kind: "after" }]);
  await expect.poll(() => queuedOnPhone(page)).toBe(0);
});

test("logout deletes queued files, so the next crew on the phone sees none", async ({ page }) => {
  // Waits out TUS's own retries.
  test.slow();
  const crew = await logInAsCrew(page);
  await openJob(page, "in_progress", crew.id);
  await page.route(TUS, (route) => route.abort("internetdisconnected"));
  await take(page, "before", "tank.jpg");
  await expect(
    section(page, "before").getByRole("listitem").filter({ hasText: "صورة 1" }),
  ).toBeVisible();

  await page.goto("/crew");
  await page.getByRole("button", { name: Profile.logout }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog", { name: Profile.logoutTitle });
  await expect(dialog.getByRole("alert")).toContainText(plural(Crew.logoutPending));
  await dialog.getByRole("button", { name: Profile.logoutConfirm }).click();
  await page.waitForURL("**/welcome");
  expect(await queuedOnPhone(page)).toBe(0);

  await logInAsCrew(page);
  expect(await queuedOnPhone(page)).toBe(0);
  await expect(page.getByText(plural(Crew.queued))).toHaveCount(0);
});

test("the finish form records the sterilant, the reading and an internal note", async ({
  page,
}) => {
  // Not changed here: admin-catalog.spec.ts changes it for a moment (to
  // "كلور تجربة …") and puts it back, so either value may be prefilled.
  const { data: settings } = await admin
    .from("settings")
    .select("sterilant_text")
    .single()
    .throwOnError();
  const crew = await logInAsCrew(page);
  const order = await openJob(page, "in_progress", crew.id);

  await page.getByRole("button", { name: Crew.steps.finish }).click();
  const sheet = page.getByRole("dialog", { name: Crew.finish.title });
  const field = sheet.getByLabel(Crew.finish.sterilant);
  const prefilled = await field.inputValue();
  expect(prefilled === settings.sterilant_text || prefilled.startsWith("كلور تجربة ")).toBe(true);

  const sterilant = "كلور الصوديوم 10%";
  await field.fill("");
  await sheet.getByRole("checkbox").check();
  await sheet.getByRole("button", { name: Crew.finish.confirm }).click();
  await expect(sheet).toContainText(Crew.errors.sterilant_required);
  await field.fill(sterilant);
  await sheet.getByLabel(Crew.finish.chlorine).fill("abc");
  await sheet.getByRole("button", { name: Crew.finish.confirm }).click();
  await expect(sheet).toContainText(Crew.errors.invalid_chlorine);

  await sheet.getByLabel(Crew.finish.chlorine).fill("0.5");
  await sheet.getByLabel(Crew.finish.note).fill("الغطا مكسور");
  await screenshot(page, "crew-finish");
  await sheet.getByRole("button", { name: Crew.finish.confirm }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText(Crew.job.closed)).toBeVisible();

  const { data: report } = await admin
    .from("job_reports")
    .select("sterilant, residual_chlorine_mg_l, crew_id")
    .eq("order_id", order.id)
    .single()
    .throwOnError();
  expect(report).toEqual({ sterilant, residual_chlorine_mg_l: 0.5, crew_id: crew.id });
  // The note is a staff note on the completion event, shown to the crew.
  await expect(page.getByRole("list").filter({ hasText: Crew.events.completed })).toContainText(
    "الغطا مكسور",
  );
});
