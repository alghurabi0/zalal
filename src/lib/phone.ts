import { z } from "zod";

/** An Iraqi mobile number in E.164, as stored everywhere (spec §5.2, decision 10). */
export const IRAQI_MOBILE_E164 = /^\+9647[3-9]\d{8}$/;

const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

/**
 * Turns Arabic-Indic (U+0660–0669) and Persian (U+06F0–06F9) digits into Western ones. An
 * Arabic keyboard types those, and pasted codes or numbers may carry them.
 */
export function toWesternDigits(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
      out += String(code - PERSIAN_ZERO);
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * Reads what the user typed into Login and returns the E.164 number, or null
 * when it isn't an Iraqi mobile number. Accepts 7XXXXXXXXX and 07XXXXXXXXX
 * (spec §5.2), and also +964 / 00964 / 964 forms that autofill and paste
 * produce. Spaces, dashes and brackets are ignored.
 */
export function normalizeIraqiMobile(input: string): string | null {
  let digits = toWesternDigits(input).replace(/[\s\-().]/g, "");
  if (digits.startsWith("+964")) digits = digits.slice(4);
  else if (digits.startsWith("00964")) digits = digits.slice(5);
  else if (digits.startsWith("964") && digits.length === 13) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);

  return /^7[3-9]\d{8}$/.test(digits) ? `+964${digits}` : null;
}

/** Zod schema for a typed phone number; parses to E.164. Shared by the Login form and the server. */
export const phoneInputSchema = z
  .string()
  .max(32)
  .transform((value, ctx) => {
    const phone = normalizeIraqiMobile(value);
    if (phone === null) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return phone;
  });

/** "+9647801234567" → "+964 780 123 4567", as the designs show numbers. Wrap it in dir="ltr". */
export function formatPhone(e164: string): string {
  const match = /^\+964(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `+964 ${match[1]} ${match[2]} ${match[3]}` : e164;
}
