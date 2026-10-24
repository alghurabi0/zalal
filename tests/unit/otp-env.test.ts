import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

const KEYS = [
  "OTPIQ_API_KEY",
  "OTPIQ_SMS_SENDER_ID",
  "OTPIQ_WHATSAPP_ACCOUNT_ID",
  "OTPIQ_WHATSAPP_PHONE_ID",
  "OTPIQ_WHATSAPP_TEMPLATE",
  "OTP_DEV_OUTBOX",
  "VERCEL_ENV",
];

// otpEnv caches what it parses, so load it fresh for each test.
async function load() {
  const env = await import("@/lib/env.server");
  const config = await import("@/lib/otp/config");
  return { ...env, ...config };
}

beforeEach(() => {
  vi.resetModules();
  for (const key of KEYS) vi.stubEnv(key, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("OTP env", () => {
  it("writes codes to OTP_DEV_OUTBOX for the e2e tests", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { mkdtemp, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(tmpdir(), "zl-outbox-"));
    vi.stubEnv("OTP_DEV_OUTBOX", dir);
    const { otpSenders } = await load();
    await otpSenders().sms.send("+9647801234567", "654321");
    expect(await readFile(path.join(dir, "+9647801234567"), "utf8")).toBe("654321");
  });

  it.each([
    ["on Vercel", { VERCEL_ENV: "preview", OTPIQ_API_KEY: "sk_dev_abc" }],
    ["with an OTPIQ key", { OTPIQ_API_KEY: "sk_dev_abc" }],
  ])("refuses OTP_DEV_OUTBOX %s", async (_, env) => {
    vi.stubEnv("OTP_DEV_OUTBOX", "/tmp/outbox");
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const { otpEnv } = await load();
    expect(() => otpEnv()).toThrow(/OTP_DEV_OUTBOX|e2e/);
  });

  it("uses the log sender locally without a key", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { otpSenders } = await load();
    const result = await otpSenders().whatsapp.send("+9647801234567", "123456");
    expect(result).toEqual({ ok: true, providerMessageId: null });
    expect(info).toHaveBeenCalledWith(expect.stringContaining("123456"));
  });

  it.each(["production", "preview"])("requires a key on Vercel %s", async (vercelEnv) => {
    vi.stubEnv("VERCEL_ENV", vercelEnv);
    const { otpEnv } = await load();
    expect(() => otpEnv()).toThrow(/OTPIQ_API_KEY/);
  });

  it("allows a dev key on previews but not in production", async () => {
    vi.stubEnv("OTPIQ_API_KEY", "sk_dev_abc");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await load()).otpEnv().OTPIQ_API_KEY).toBe("sk_dev_abc");

    vi.resetModules();
    vi.stubEnv("VERCEL_ENV", "production");
    await expect((async () => (await load()).otpEnv())()).rejects.toThrow(/live key/);
  });

  it("refuses a malformed key", async () => {
    vi.stubEnv("OTPIQ_API_KEY", "abc123");
    const { otpEnv } = await load();
    expect(() => otpEnv()).toThrow(/sk_live_ or sk_dev_/);
  });

  it("needs all three WhatsApp settings or none", async () => {
    vi.stubEnv("OTPIQ_API_KEY", "sk_live_abc");
    vi.stubEnv("OTPIQ_WHATSAPP_ACCOUNT_ID", "acc");
    const { otpEnv } = await load();
    expect(() => otpEnv()).toThrow(/together/);
  });

  it("sends through OTPIQ when a key is set", async () => {
    vi.stubEnv("OTPIQ_API_KEY", "sk_live_abc");
    vi.stubEnv("OTPIQ_SMS_SENDER_ID", "Zalal");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ smsId: "sms-1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { otpSenders } = await load();
    expect(await otpSenders().sms.send("+9647801234567", "123456")).toEqual({
      ok: true,
      providerMessageId: "sms-1",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, string>;
    expect(body).toMatchObject({ provider: "sms", senderId: "Zalal" });
    vi.unstubAllGlobals();
  });
});
