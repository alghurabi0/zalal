import { expect, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { e164, screenshot, signUp } from "./helpers/auth";
import { admin } from "./helpers/supabase";

// Location (spec §5.4) and the address picker (N2).

const { Location, Addresses, Home } = messages;

async function addressesOf(phone: string) {
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", e164(phone))
    .single()
    .throwOnError();
  const { data } = await admin
    .from("addresses")
    .select("label, district, is_default, deleted_at, lat, lng")
    .eq("user_id", profile.id)
    .order("created_at")
    .throwOnError();
  return data;
}

test.describe("outside Karbala", () => {
  // Baghdad: outside the seeded service area.
  test.use({
    geolocation: { latitude: 33.3152, longitude: 44.3661 },
    permissions: ["geolocation"],
  });

  test("a pin outside the service area is refused and not saved", async ({ page }) => {
    const phone = await signUp(page, { address: false });
    await page.goto("/addresses/new");
    // The new-address screen starts from the user's position.
    await page.getByLabel(Location.district).fill("المنصور");
    await page.getByLabel(Location.landmark).fill("قرب الساعة");
    await page.getByRole("button", { name: Location.save }).click();

    await expect(page.getByText(Location.errors.outsideArea)).toBeVisible();
    await expect(page).toHaveURL("/addresses/new");
    expect(await addressesOf(phone)).toEqual([]);
  });
});

test.describe("inside Karbala", () => {
  test.use({
    geolocation: { latitude: 32.6, longitude: 44.02 },
    permissions: ["geolocation"],
  });

  test("موقعي الحالي places the pin, and the address saves there", async ({ page }) => {
    const phone = await signUp(page, { address: false });
    await page.goto("/addresses/new");
    await page.getByRole("button", { name: Location.myLocation }).click();
    await expect(page.getByRole("button", { name: Location.myLocation })).toBeVisible();
    await page.getByLabel(Location.district).fill("حي العباس");
    await page.getByLabel(Location.landmark).fill("قرب المدرسة");
    await page.getByRole("radio", { name: Location.labels.family }).check({ force: true });
    await page.getByRole("button", { name: Location.save }).click();
    await page.waitForURL((url) => url.pathname === "/");

    const [address] = await addressesOf(phone);
    expect(address).toMatchObject({ label: "family", lat: 32.6, lng: 44.02, is_default: true });
  });
});

test("a link in the picker takes the sheet's place in history", async ({ page }) => {
  await signUp(page);
  const before = await page.evaluate(() => history.length);

  await page.getByRole("button", { name: new RegExp(Home.deliverTo) }).click();
  const picker = page.getByRole("dialog", { name: Addresses.pickTitle });
  await expect(picker).toBeVisible();
  await picker.getByRole("link", { name: Addresses.add }).click();
  await page.waitForURL("**/addresses/new");
  // One entry for the new page, none left over for the sheet.
  expect(await page.evaluate(() => history.length)).toBe(before + 1);

  await page.goBack();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(picker).toBeHidden();
});

test("the picker selects, marks default, edits and deletes addresses", async ({ page }) => {
  const phone = await signUp(page);

  // A second address from the picker: its label is the first one still free.
  await page.getByRole("button", { name: new RegExp(Home.deliverTo) }).click();
  const picker = page.getByRole("dialog", { name: Addresses.pickTitle });
  await expect(picker.getByText(Addresses.default)).toBeVisible();
  await picker.getByRole("link", { name: Addresses.add }).click();
  await page.waitForURL("**/addresses/new");
  await expect(page.getByRole("radio", { name: new RegExp(Location.labels.home) })).toBeDisabled();
  await expect(page.getByRole("radio", { name: Location.labels.family })).toBeChecked();
  await page.getByLabel(Location.district).fill("حي النقيب");
  await page.getByLabel(Location.landmark).fill("قرب السوق");
  await page.getByRole("button", { name: Location.save }).click();
  await page.waitForURL((url) => url.pathname === "/");

  // Select: Home shows the chosen address.
  await page.getByRole("button", { name: new RegExp(Home.deliverTo) }).click();
  await screenshot(page, "address-picker");
  await picker.getByRole("button", { name: `اختار ${Location.labels.family}` }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByRole("button", { name: /بيت الأهل · حي النقيب/ })).toBeVisible();

  // Mark default.
  await page.getByRole("button", { name: new RegExp(Home.deliverTo) }).click();
  await picker
    .getByRole("button", { name: `${Addresses.makeDefault}: ${Location.labels.family}` })
    .click();
  await expect(
    picker.getByRole("button", { name: `${Addresses.makeDefault}: ${Location.labels.home}` }),
  ).toBeVisible();
  expect((await addressesOf(phone)).map((a) => [a.label, a.is_default])).toEqual([
    ["home", false],
    ["family", true],
  ]);

  // Edit.
  await picker.getByRole("link", { name: `${Addresses.edit} ${Location.labels.home}` }).click();
  await page.waitForURL("**/addresses/*/edit**");
  await expect(page.getByRole("heading", { level: 1, name: Location.editTitle })).toBeVisible();
  // Next keeps the earlier Location page alive (hidden): use the visible one.
  await page.getByLabel(Location.district).filter({ visible: true }).fill("حي الحر");
  await page.getByRole("button", { name: Location.save }).filter({ visible: true }).click();
  await page.waitForURL((url) => url.pathname === "/");

  // Delete, after a confirmation.
  await page.getByRole("button", { name: new RegExp(Home.deliverTo) }).click();
  await picker.getByRole("button", { name: `${Addresses.delete} ${Location.labels.home}` }).click();
  await picker.getByRole("button", { name: Addresses.confirmDeleteYes }).click();
  await expect(picker.getByText("حي الحر")).toBeHidden();

  const after = await addressesOf(phone);
  expect(after.find((a) => a.label === "home")).toMatchObject({ district: "حي الحر" });
  expect(after.find((a) => a.label === "home")?.deleted_at).not.toBeNull();
});
