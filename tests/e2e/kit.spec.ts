import { expect, test } from "@playwright/test";

import messages from "../../messages/ar.json" with { type: "json" };

const kit = messages.Kit;

test.beforeEach(async ({ page }) => {
  await page.goto("/kit");
});

test("screenshots the kit", async ({ page }) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "test-results/screenshots/kit.png", fullPage: true });
});

test("the sheet traps focus, closes on Esc and returns focus", async ({ page }) => {
  const trigger = page.getByRole("button", { name: kit.openSheet });
  await trigger.click();

  const sheet = page.getByRole("dialog", { name: kit.sheetTitle });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAccessibleDescription(kit.sheetBody);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "test-results/screenshots/kit-sheet.png" });

  // Tabbing many times never leaves the sheet.
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("tapping above the sheet closes it", async ({ page }) => {
  await page.getByRole("button", { name: kit.openSheet }).click();
  const sheet = page.getByRole("dialog", { name: kit.sheetTitle });
  await expect(sheet).toBeVisible();

  await page.mouse.click(195, 20);
  await expect(sheet).toBeHidden();
});

test("the stepper stays between its limits", async ({ page }) => {
  const group = page.getByRole("group", { name: kit.countLabel });
  const increase = group.getByRole("button", { name: messages.UI.increase });
  const decrease = group.getByRole("button", { name: messages.UI.decrease });
  const value = group.locator("output");

  // Playwright waits for aria-disabled buttons to become enabled; force
  // the click to check that a click at the limit does nothing.
  await expect(decrease).toHaveAttribute("aria-disabled", "true");
  await decrease.click({ force: true });
  await expect(value).toHaveText("1");

  for (let i = 0; i < 7; i++) await increase.click({ force: true });
  await expect(value).toHaveText("6");
  await expect(increase).toHaveAttribute("aria-disabled", "true");
  // Focus stays on the button at the limit.
  await expect(increase).toBeFocused();
});

test("arrow keys move between radio chips", async ({ page }) => {
  const whatsapp = page.getByRole("radio", { name: kit.whatsapp });
  const sms = page.getByRole("radio", { name: kit.sms });

  await expect(whatsapp).toBeChecked();
  await whatsapp.focus();
  await page.keyboard.press("ArrowDown");
  await expect(sms).toBeChecked();
  await expect(sms).toBeFocused();
});

test("every control is at least 44×44 to touch", async ({ page }) => {
  const small = await page.evaluate(() => {
    const controls = document.querySelectorAll<HTMLElement>(
      'a, button, label:has(input), input:not([type="hidden"]):not(.sr-only), textarea',
    );
    const problems: string[] = [];
    for (const el of controls) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.width >= 44 && box.height >= 44) continue;
      // Chips drawn 36px tall extend their touch area with ::after.
      const after = getComputedStyle(el, "::after");
      const top = parseFloat(after.top);
      const extra = after.position === "absolute" && top < 0 ? -2 * top : 0;
      if (box.width >= 44 && box.height + extra >= 44) continue;
      problems.push(`${el.tagName} "${el.textContent?.trim()}" ${box.width}×${box.height}`);
    }
    return problems;
  });
  expect(small).toEqual([]);
});

test("shows the offline banner while offline", async ({ page, context }) => {
  const banner = page.getByRole("status").filter({ hasText: messages.UI.offline });
  await expect(banner).toHaveCount(0);

  await context.setOffline(true);
  await expect(banner).toBeVisible();

  await context.setOffline(false);
  await expect(banner).toHaveCount(0);
});
