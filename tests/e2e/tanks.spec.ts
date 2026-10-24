import { expect, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

import { e164, screenshot, signUp } from "./helpers/auth";
import { admin } from "./helpers/supabase";

// My tanks (N3).

const { Tanks, Profile } = messages;

test("without an address, My tanks asks for one first", async ({ page }) => {
  await signUp(page, { address: false });
  await page.goto("/tanks");
  await expect(page.getByRole("heading", { name: Tanks.noAddressTitle })).toBeVisible();
  await expect(page.getByRole("link", { name: Tanks.noAddressCta })).toHaveAttribute(
    "href",
    "/addresses/new?next=%2Ftanks",
  );
});

test("adds, edits and deletes a tank, grouped under its address", async ({ page }) => {
  const phone = await signUp(page);
  await page.goto("/profile");
  await expect(page.getByRole("link", { name: new RegExp(Profile.tanks) })).toContainText(
    "ماكو خزانات",
  );
  await page.getByRole("link", { name: new RegExp(Profile.tanks) }).click();
  await expect(page).toHaveURL("/tanks");
  await expect(page.getByRole("heading", { name: /البيت · حي الحسين/ })).toBeVisible();
  await expect(page.getByText(Tanks.noTanksAtAddress)).toBeVisible();

  // Add.
  await page.getByRole("button", { name: Tanks.add }).click();
  const sheet = page.getByRole("dialog", { name: Tanks.addTitle });
  await sheet.getByText(Tanks.types.ground).click();
  await sheet.getByText(Tanks.sizes.l).click();
  await sheet.getByLabel(Tanks.nickname).fill("خزان الحديقة");
  await screenshot(page, "tank-sheet");
  await sheet.getByRole("button", { name: Tanks.save }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("خزان الحديقة")).toBeVisible();
  await expect(page.getByText(`${Tanks.types.ground} · ${Tanks.sizes.l}`)).toBeVisible();
  await expect(page.getByText(Tanks.neverCleaned)).toBeVisible();

  // Edit.
  await page.getByRole("button", { name: `${Tanks.edit} خزان الحديقة` }).click();
  const edit = page.getByRole("dialog", { name: Tanks.editTitle });
  await expect(edit.getByRole("radio", { name: new RegExp(Tanks.types.ground) })).toBeChecked();
  await edit.getByText(Tanks.sizes.s).click();
  await edit.getByLabel(Tanks.nickname).fill("");
  await edit.getByRole("button", { name: Tanks.save }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText(Tanks.types.ground, { exact: true })).toBeVisible();
  await expect(page.getByText(Tanks.sizes.s, { exact: true })).toBeVisible();

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", e164(phone))
    .single()
    .throwOnError();
  const { data: tanks } = await admin
    .from("tanks")
    .select("type, size, nickname")
    .eq("user_id", profile.id)
    .throwOnError();
  expect(tanks).toEqual([{ type: "ground", size: "s", nickname: null }]);

  // A cleaning date shows last and next (the interval setting, 6 months).
  await admin
    .from("tanks")
    .update({ last_cleaned_at: "2026-03-15T09:00:00Z" })
    .eq("user_id", profile.id)
    .throwOnError();
  await page.reload();
  await expect(page.getByText("آخر تنظيف: 15 آذار 2026")).toBeVisible();
  await expect(page.getByText("التنظيف الجاي: 15 أيلول 2026")).toBeVisible();
  await screenshot(page, "tanks");

  // Delete, after a confirmation.
  await page.getByRole("button", { name: `${Tanks.delete} ${Tanks.types.ground}` }).click();
  await page.getByRole("button", { name: Tanks.confirmDeleteYes }).click();
  await expect(page.getByText(Tanks.noTanksAtAddress)).toBeVisible();
});
