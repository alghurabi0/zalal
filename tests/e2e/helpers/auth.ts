import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

import messages from "../../../messages/ar.json" with { type: "json" };

import { OTP_OUTBOX } from "./outbox";
import { admin } from "./supabase";

/** A fresh Iraqi mobile number (local form, 07…) for each test. */
export function newPhone(): string {
  return `077${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

export const e164 = (local: string) => `+964${local.slice(1)}`;

/** The code the app "sent" to this number (written by the log sender). */
export async function readCode(local: string): Promise<string> {
  const file = path.join(OTP_OUTBOX, e164(local));
  let code = "";
  await expect
    .poll(async () => (code = await readFile(file, "utf8").catch(() => "")), { timeout: 10_000 })
    .toMatch(/^\d{6}$/);
  return code;
}

/** Login → OTP for this number. Stops on the OTP screen. */
export async function requestCode(page: Page, local: string, loginUrl = "/login") {
  await rm(path.join(OTP_OUTBOX, e164(local)), { force: true });
  await page.goto(loginUrl);
  await page.getByLabel(messages.Login.phone).fill(local);
  await page.getByRole("button", { name: messages.Login.send }).click();
  await page.waitForURL("**/login/verify");
}

/**
 * Moves this number's earlier sends back 10 minutes, so a test can log in
 * again without waiting out the 45 s and 10-minute send limits.
 */
export async function skipSendLimits(local: string) {
  await admin
    .from("otp_requests")
    .update({ created_at: new Date(Date.now() - 11 * 60_000).toISOString() })
    .eq("phone", e164(local))
    .throwOnError();
}

/** Types the code on the OTP screen; it submits itself at 6 digits. */
export async function enterCode(page: Page, local: string) {
  await page.getByLabel(messages.Otp.codeLabel).fill(await readCode(local));
}

/**
 * A new customer: login, Name and, unless `address` is false, an address at
 * Karbala center (Location's start when there's no GPS). Ends on Home.
 */
export async function signUp(
  page: Page,
  { phone = newPhone(), name = "أحمد علي", address = true } = {},
) {
  await requestCode(page, phone);
  await enterCode(page, phone);
  await page.waitForURL("**/onboarding/name**");
  await page.getByLabel(messages.Name.label).fill(name);
  await page.getByRole("button", { name: messages.Name.submit }).click();
  await page.waitForURL("**/addresses/new?onboarding=1**");
  if (address) {
    await page.getByLabel(messages.Location.district).fill("حي الحسين");
    await page.getByLabel(messages.Location.landmark).fill("قرب جامع الحسين");
    await page.getByRole("button", { name: messages.Location.save }).click();
  } else {
    await page.getByRole("link", { name: messages.Location.later }).click();
  }
  await page.waitForURL((url) => url.pathname === "/");
  return phone;
}

export async function screenshot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `test-results/screenshots/${name}.png` });
}
