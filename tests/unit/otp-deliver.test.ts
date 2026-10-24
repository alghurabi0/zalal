import { describe, expect, it, vi } from "vitest";

import { generateOtpCode, hashOtpCode, signInPassword } from "@/lib/otp/code";
import { deliverOtp } from "@/lib/otp/deliver";
import type { OtpSender, SendResult } from "@/lib/otp/senders";

vi.mock("server-only", () => ({}));

function sender(result: SendResult) {
  const send = vi.fn<OtpSender["send"]>(async () => result);
  return { send };
}

const sent = (id: string): SendResult => ({ ok: true, providerMessageId: id });
const failed = (error: Extract<SendResult, { ok: false }>["error"]): SendResult => ({
  ok: false,
  error,
});

const base = { phone: "+9647801234567", code: "123456" };

describe("deliverOtp (spec §9.1)", () => {
  it("sends over WhatsApp when it works", async () => {
    const whatsapp = sender(sent("wa-1"));
    const sms = sender(sent("sms-1"));
    const result = await deliverOtp({
      ...base,
      channel: "whatsapp",
      smsEnabled: true,
      senders: { whatsapp, sms },
    });
    expect(result).toEqual({ ok: true, channelUsed: "whatsapp", providerMessageId: "wa-1" });
    expect(whatsapp.send).toHaveBeenCalledWith("+9647801234567", "123456");
    expect(sms.send).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "rejected", "not_configured"] as const)(
    "retries once over SMS when WhatsApp fails with %s and SMS is on",
    async (error) => {
      const whatsapp = sender(failed(error));
      const sms = sender(sent("sms-1"));
      const result = await deliverOtp({
        ...base,
        channel: "whatsapp",
        smsEnabled: true,
        senders: { whatsapp, sms },
      });
      expect(result).toEqual({ ok: true, channelUsed: "sms", providerMessageId: "sms-1" });
      expect(sms.send).toHaveBeenCalledOnce();
      expect(sms.send).toHaveBeenCalledWith("+9647801234567", "123456");
    },
  );

  it("does not fall back while SMS is off", async () => {
    const whatsapp = sender(failed("unavailable"));
    const sms = sender(sent("sms-1"));
    const result = await deliverOtp({
      ...base,
      channel: "whatsapp",
      smsEnabled: false,
      senders: { whatsapp, sms },
    });
    expect(result).toEqual({ ok: false, error: "unavailable", triedSms: false });
    expect(sms.send).not.toHaveBeenCalled();
  });

  it.each(["provider_account", "rate_limited"] as const)(
    "does not fall back on %s, which SMS would hit too",
    async (error) => {
      const whatsapp = sender(failed(error));
      const sms = sender(sent("sms-1"));
      const result = await deliverOtp({
        ...base,
        channel: "whatsapp",
        smsEnabled: true,
        senders: { whatsapp, sms },
      });
      expect(result).toEqual({ ok: false, error, triedSms: false });
      expect(sms.send).not.toHaveBeenCalled();
    },
  );

  it("reports the SMS error when both channels fail", async () => {
    const whatsapp = sender(failed("unavailable"));
    const sms = sender(failed("rejected"));
    const result = await deliverOtp({
      ...base,
      channel: "whatsapp",
      smsEnabled: true,
      senders: { whatsapp, sms },
    });
    expect(result).toEqual({ ok: false, error: "rejected", triedSms: true });
    expect(whatsapp.send).toHaveBeenCalledOnce();
    expect(sms.send).toHaveBeenCalledOnce();
  });

  it("sends a chosen SMS once, with no WhatsApp attempt", async () => {
    const whatsapp = sender(sent("wa-1"));
    const sms = sender(failed("unavailable"));
    const result = await deliverOtp({
      ...base,
      channel: "sms",
      smsEnabled: true,
      senders: { whatsapp, sms },
    });
    expect(result).toEqual({ ok: false, error: "unavailable", triedSms: true });
    expect(whatsapp.send).not.toHaveBeenCalled();
    expect(sms.send).toHaveBeenCalledOnce();
  });
});

describe("OTP codes", () => {
  it("are 6 digits, leading zeros included", () => {
    for (let i = 0; i < 200; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it("hash to 64 hex characters, bound to the phone, code and secret", () => {
    const hash = hashOtpCode("secret", "+9647801234567", "123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOtpCode("secret", "+9647801234567", "123456")).toBe(hash);
    expect(hashOtpCode("secret", "+9647801234568", "123456")).not.toBe(hash);
    expect(hashOtpCode("secret", "+9647801234567", "123457")).not.toBe(hash);
    expect(hashOtpCode("other", "+9647801234567", "123456")).not.toBe(hash);
  });

  it("sign-in passwords are long, stable per user and bound to the secret", () => {
    const a = signInPassword("secret", "user-1");
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(signInPassword("secret", "user-1")).toBe(a);
    expect(signInPassword("secret", "user-2")).not.toBe(a);
    expect(signInPassword("other", "user-1")).not.toBe(a);
  });
});
