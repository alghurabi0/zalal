import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DSN = "https://key@o123.ingest.de.sentry.io/456";

const posthogInit = vi.fn();
vi.mock("posthog-js", () => ({ default: { init: posthogInit } }));

// Each test sets its own env, and the modules cache what they parse, so load
// them fresh every time.
async function load() {
  const env = await import("@/lib/env");
  const sentry = await import("@/lib/monitoring/sentry");
  const analytics = await import("@/lib/monitoring/analytics");
  const paths = await import("@/lib/monitoring/paths");
  return { ...env, ...sentry, ...analytics, ...paths };
}

beforeEach(() => {
  vi.resetModules();
  posthogInit.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", undefined);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", undefined);
  vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("monitoring env", () => {
  it("treats unset and empty values as off", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const { monitoringEnv, deployEnv } = await load();
    expect(monitoringEnv()).toEqual({
      NEXT_PUBLIC_SENTRY_DSN: undefined,
      NEXT_PUBLIC_POSTHOG_KEY: undefined,
      NEXT_PUBLIC_VERCEL_ENV: undefined,
    });
    expect(deployEnv()).toBe("local");
  });

  it("rejects a malformed DSN, which fails the build (next.config.ts)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "not-a-url");
    const { monitoringEnv } = await load();
    expect(() => monitoringEnv()).toThrow();
  });

  it("names the Vercel environment, and calls `vercel dev` local", async () => {
    for (const [vercel, expected] of [
      ["production", "production"],
      ["preview", "preview"],
      ["development", "local"],
    ] as const) {
      vi.resetModules();
      vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", vercel);
      const { deployEnv } = await load();
      expect(deployEnv()).toBe(expected);
    }
  });
});

describe("Sentry options", () => {
  it("are off without a DSN", async () => {
    const { sentryOptions } = await load();
    expect(sentryOptions()).toMatchObject({ dsn: undefined, enabled: false, environment: "local" });
  });

  it("sample 10% of production traces and all preview traces", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
    const { sentryOptions } = await load();
    expect(sentryOptions()).toMatchObject({
      dsn: DSN,
      enabled: true,
      environment: "production",
      tracesSampleRate: 0.1,
    });

    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    expect((await load()).sentryOptions().tracesSampleRate).toBe(1);
  });

  it("send nothing personal", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    const { sentryOptions } = await load();
    expect(sentryOptions().dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    });
  });
});

describe("analytics", () => {
  it("doesn't load PostHog without a key", async () => {
    const { startAnalytics } = await load();
    startAnalytics();
    await vi.dynamicImportSettled();
    expect(posthogInit).not.toHaveBeenCalled();
  });

  it("starts PostHog through our own path, with no text, recording or anonymous profiles", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    const { startAnalytics, ANALYTICS_PATH } = await load();
    startAnalytics();
    await vi.dynamicImportSettled();

    expect(posthogInit).toHaveBeenCalledOnce();
    expect(posthogInit).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: ANALYTICS_PATH,
        person_profiles: "identified_only",
        mask_all_text: true,
        mask_personal_data_properties: true,
        disable_session_recording: true,
        disable_external_dependency_loading: true,
        capture_exceptions: false,
      }),
    );
  });
});
