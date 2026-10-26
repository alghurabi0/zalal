import type { Database } from "@/lib/database.types";

// Certificate and ticket labels (spec §5.15, §10.1, N15). Safe for the browser.

export type RatingTag = Database["public"]["Enums"]["rating_tag"];

/** The company tags on Report, in the canvas's order ("الصور واضحة" replaces "الفيديو واضح"). */
export const RATING_TAGS = [
  "on_time",
  "clean_work",
  "respectful",
  "clear_photos",
] as const satisfies readonly RatingTag[];

/** 3 stars or fewer opens a support ticket (decision 49). */
export const TICKET_STARS = 3;

/** The certificate number is the order's: #1024 → "ZL-1024". */
export function certificateNumber(orderNumber: number): string {
  return `ZL-${orderNumber}`;
}

/** "ZL-T-1001" */
export function ticketNumber(number: number): string {
  return `ZL-T-${number}`;
}

/** 8 characters without 0, 1, I or O (migration certificates). */
const PUBLIC_CODE = /^[A-HJ-NP-Z2-9]{8}$/;

/** A code from a URL or typed by hand, upper-cased; null if it can't be one. */
export function normalizePublicCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return PUBLIC_CODE.test(code) ? code : null;
}

/**
 * The phone on the certificate (spec §10.1): "+9647801234567" →
 * "0780 ••• 4567". Wrap it in dir="ltr".
 */
export function maskPhone(e164: string): string {
  const match = /^\+964(\d{3})\d{3}(\d{4})$/.exec(e164);
  return match ? `0${match[1]} ••• ${match[2]}` : "•••";
}
