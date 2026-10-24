import { describe, expect, it, vi } from "vitest";

import { OTPIQ_API_URL, otpiqSender, type OtpiqConfig } from "@/lib/otp/otpiq";

vi.mock("server-only", () => ({}));

// Response bodies are the examples from docs.otpiq.com/api-reference/messaging/post.

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setup(response: Response | Error, config: Partial<OtpiqConfig> = {}) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const onAccountProblem = vi.fn();
  const make = (channel: "whatsapp" | "sms") =>
    otpiqSender(channel, { apiKey: "sk_live_test", fetch: fetchMock, onAccountProblem, ...config });
  return { fetchMock, onAccountProblem, make };
}

function sentBody(fetchMock: ReturnType<typeof setup>["fetchMock"]) {
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, string>;
}

const success = {
  message: "SMS task created successfully",
  smsId: "sms-1234567890abcdef12345678",
  remainingCredit: 14800,
  cost: 200,
  canCover: true,
  paymentType: "prepaid",
};

describe("OTPIQ sender", () => {
  it("sends a WhatsApp verification code", async () => {
    const { fetchMock, make } = setup(jsonResponse(200, success));
    const result = await make("whatsapp").send("+9647801234567", "123456");

    expect(result).toEqual({ ok: true, providerMessageId: "sms-1234567890abcdef12345678" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${OTPIQ_API_URL}/sms`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk_live_test");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(sentBody(fetchMock)).toEqual({
      phoneNumber: "9647801234567",
      smsType: "verification",
      verificationCode: "123456",
      provider: "whatsapp",
    });
  });

  it("sends an SMS with the sender ID, and WhatsApp with our own number", async () => {
    const whatsapp = { accountId: "acc", phoneId: "ph", templateName: "zalal_otp" };
    const sms = setup(jsonResponse(200, success), { smsSenderId: "Zalal", whatsapp });
    await sms.make("sms").send("+9647801234567", "123456");
    expect(sentBody(sms.fetchMock)).toEqual({
      phoneNumber: "9647801234567",
      smsType: "verification",
      verificationCode: "123456",
      provider: "sms",
      senderId: "Zalal",
    });

    const wa = setup(jsonResponse(200, success), { smsSenderId: "Zalal", whatsapp });
    await wa.make("whatsapp").send("+9647801234567", "123456");
    expect(sentBody(wa.fetchMock)).toEqual({
      phoneNumber: "9647801234567",
      smsType: "verification",
      verificationCode: "123456",
      provider: "whatsapp",
      whatsappAccountId: "acc",
      whatsappPhoneId: "ph",
      templateName: "zalal_otp",
    });
  });

  it("treats any 200 as sent, even without an smsId", async () => {
    const { make } = setup(jsonResponse(200, { message: "ok" }));
    expect(await make("sms").send("+9647801234567", "123456")).toEqual({
      ok: true,
      providerMessageId: null,
    });
  });

  it("reports network errors and timeouts as unavailable", async () => {
    const { make } = setup(new TypeError("fetch failed"));
    expect(await make("whatsapp").send("+9647801234567", "123456")).toEqual({
      ok: false,
      error: "unavailable",
    });
    const timeout = setup(new DOMException("The operation timed out.", "TimeoutError"));
    expect(await timeout.make("whatsapp").send("+9647801234567", "123456")).toEqual({
      ok: false,
      error: "unavailable",
    });
  });

  it("times out after the configured time", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const sender = otpiqSender("whatsapp", {
      apiKey: "sk_live_x",
      fetch: fetchMock,
      timeoutMs: 20,
    });
    expect(await sender.send("+9647801234567", "123456")).toEqual({
      ok: false,
      error: "unavailable",
    });
  });

  it("maps 5xx to unavailable", async () => {
    const { make, onAccountProblem } = setup(
      jsonResponse(500, { message: "Internal server error" }),
    );
    expect(await make("sms").send("+9647801234567", "1")).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(onAccountProblem).not.toHaveBeenCalled();
  });

  it("maps 429 to rate_limited", async () => {
    const { make } = setup(
      jsonResponse(429, {
        message: "Rate limit exceeded. Please try again in 8 minutes.",
        waitMinutes: 8,
        maxRequests: 10,
        timeWindowMinutes: 10,
      }),
    );
    expect(await make("sms").send("+9647801234567", "1")).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });

  it("maps a validation 400 to rejected, without alerting the owner", async () => {
    const { make, onAccountProblem } = setup(
      jsonResponse(400, {
        error: "Phone must be a valid number without any spaces or special characters.",
      }),
    );
    expect(await make("whatsapp").send("+9647801234567", "1")).toEqual({
      ok: false,
      error: "rejected",
    });
    expect(onAccountProblem).not.toHaveBeenCalled();
  });

  it.each([
    [
      "insufficient_credit",
      {
        error: "Insufficient credit, please add more credit",
        yourCredit: 100,
        requiredCredit: 200,
        canCover: false,
      },
    ],
    [
      "spending_threshold",
      {
        error:
          "Project spending threshold of 10,000 IQD would be exceeded. Current spending: 9,500 IQD",
        currentSpending: 9500,
        spendingThreshold: 10000,
        cost: 200,
      },
    ],
    [
      "trial_mode",
      {
        error:
          "Account is in trial mode, you can only send sms to your own phone number for verification, add credit to send to other numbers",
      },
    ],
    ["sender_id", { error: "SenderID is not accepted, please wait for it to be accepted" }],
  ])("maps a 400 %s to provider_account and alerts the owner", async (kind, body) => {
    const { make, onAccountProblem } = setup(jsonResponse(400, body));
    expect(await make("sms").send("+9647801234567", "1")).toEqual({
      ok: false,
      error: "provider_account",
    });
    expect(onAccountProblem).toHaveBeenCalledWith({ channel: "sms", status: 400, kind });
  });

  it("maps 401 to provider_account and alerts the owner", async () => {
    const { make, onAccountProblem } = setup(
      jsonResponse(401, { message: "Unauthorized, please use your project api key" }),
    );
    expect(await make("whatsapp").send("+9647801234567", "1")).toEqual({
      ok: false,
      error: "provider_account",
    });
    expect(onAccountProblem).toHaveBeenCalledWith({
      channel: "whatsapp",
      status: 401,
      kind: "unauthorized",
    });
  });

  it("never passes the phone or code to the owner alert", async () => {
    const { make, onAccountProblem } = setup(jsonResponse(401, {}));
    await make("whatsapp").send("+9647801234567", "654321");
    const alert = JSON.stringify(onAccountProblem.mock.calls);
    expect(alert).not.toContain("7801234567");
    expect(alert).not.toContain("654321");
  });

  it("copes with a non-JSON error body", async () => {
    const { make } = setup(new Response("<html>Bad Gateway</html>", { status: 502 }));
    expect(await make("sms").send("+9647801234567", "1")).toEqual({
      ok: false,
      error: "unavailable",
    });
  });
});
