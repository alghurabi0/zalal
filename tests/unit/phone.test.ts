import { describe, expect, it } from "vitest";

import { otpCodeSchema, requestOtpInputSchema } from "@/lib/otp/schemas";
import { formatPhone, IRAQI_MOBILE_E164, normalizeIraqiMobile, toWesternDigits } from "@/lib/phone";

// Arabic-Indic and Persian digits, built from code points so the test reads
// the same in any editor.
const arabicIndic = (digits: string) =>
  [...digits].map((d) => String.fromCharCode(0x0660 + Number(d))).join("");
const persian = (digits: string) =>
  [...digits].map((d) => String.fromCharCode(0x06f0 + Number(d))).join("");

describe("normalizeIraqiMobile", () => {
  it.each([
    ["7801234567", "+9647801234567"],
    ["07801234567", "+9647801234567"],
    ["0780 123 4567", "+9647801234567"],
    ["0780-123-4567", "+9647801234567"],
    ["+9647801234567", "+9647801234567"],
    ["+964 780 123 4567", "+9647801234567"],
    ["009647801234567", "+9647801234567"],
    ["9647801234567", "+9647801234567"],
    ["7301234567", "+9647301234567"],
    ["7901234567", "+9647901234567"],
  ])("reads %s as %s", (input, expected) => {
    expect(normalizeIraqiMobile(input)).toBe(expected);
  });

  it("reads Arabic-Indic and Persian digits", () => {
    expect(normalizeIraqiMobile(arabicIndic("07801234567"))).toBe("+9647801234567");
    expect(normalizeIraqiMobile(persian("7801234567"))).toBe("+9647801234567");
  });

  it.each([
    "",
    "780123456", // 9 digits
    "78012345678", // 11 digits
    "7201234567", // 72 is not a mobile prefix
    "7001234567",
    "6801234567",
    "+9647201234567",
    "+9637801234567", // Syria
    "780123456a",
    "007801234567",
  ])("refuses %s", (input) => {
    expect(normalizeIraqiMobile(input)).toBeNull();
  });

  it("always returns a number the database accepts", () => {
    expect(normalizeIraqiMobile("07501234567")).toMatch(IRAQI_MOBILE_E164);
  });
});

describe("toWesternDigits", () => {
  it("leaves other text alone", () => {
    expect(toWesternDigits(`a${arabicIndic("123")}-${persian("45")}`)).toBe("a123-45");
  });
});

describe("OTP input schemas", () => {
  it("parses a Login request to E.164", () => {
    expect(requestOtpInputSchema.parse({ phone: "0780 123 4567", channel: "whatsapp" })).toEqual({
      phone: "+9647801234567",
      channel: "whatsapp",
    });
  });

  it("refuses an unknown channel", () => {
    expect(
      requestOtpInputSchema.safeParse({ phone: "07801234567", channel: "telegram" }).success,
    ).toBe(false);
  });

  it("accepts a 6-digit code in any digit script", () => {
    expect(otpCodeSchema.parse("012345")).toBe("012345");
    expect(otpCodeSchema.parse(arabicIndic("012345"))).toBe("012345");
    expect(otpCodeSchema.parse(" 123456 ")).toBe("123456");
  });

  it.each(["12345", "1234567", "12345a", ""])("refuses the code %j", (code) => {
    expect(otpCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe("formatPhone", () => {
  it("groups an Iraqi number as the designs show it", () => {
    expect(formatPhone("+9647801234567")).toBe("+964 780 123 4567");
  });

  it("leaves anything else as it is", () => {
    expect(formatPhone("+12025550123")).toBe("+12025550123");
  });
});
