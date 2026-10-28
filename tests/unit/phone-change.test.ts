import { describe, expect, it, vi } from "vitest";

import { decodePhoneChange, encodePhoneChange, type PhoneChange } from "@/lib/auth/phone-change";

vi.mock("server-only", () => ({}));

// The phone change cookie (N10) records that the current number was proved,
// so it must not be forgeable, reusable by another user, or kept past 15 min.

const secret = "s".repeat(40);
const now = 1_800_000_000_000;
const userId = "6f1c2a1e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const value: PhoneChange = {
  userId,
  step: "new",
  phone: null,
  channel: "whatsapp",
  sentAt: now,
  smsEnabled: true,
  expiresAt: now + 15 * 60 * 1000,
};

describe("phone change cookie", () => {
  it("round-trips", () => {
    expect(decodePhoneChange(secret, encodePhoneChange(secret, value), userId, now)).toEqual(value);
  });

  it("refuses an edited payload", () => {
    const [, signature] = encodePhoneChange(secret, { ...value, step: "current" }).split(".");
    const forged = `${Buffer.from(JSON.stringify(value)).toString("base64url")}.${signature}`;
    expect(decodePhoneChange(secret, forged, userId, now)).toBeNull();
  });

  it("refuses another secret, another user and an expired change", () => {
    const token = encodePhoneChange(secret, value);
    expect(decodePhoneChange("t".repeat(40), token, userId, now)).toBeNull();
    expect(
      decodePhoneChange(secret, token, "00000000-0000-4000-8000-000000000000", now),
    ).toBeNull();
    expect(decodePhoneChange(secret, token, userId, value.expiresAt)).toBeNull();
  });

  it("refuses garbage", () => {
    expect(decodePhoneChange(secret, undefined, userId, now)).toBeNull();
    expect(decodePhoneChange(secret, "abc", userId, now)).toBeNull();
    expect(decodePhoneChange(secret, "a.b", userId, now)).toBeNull();
  });
});
