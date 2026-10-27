import { chromium, defineConfig, devices } from "@playwright/test";

import { OTP_OUTBOX } from "./tests/e2e/helpers/outbox";
import { E2E_VAPID_PUBLIC_KEY } from "./tests/e2e/helpers/push";

const PORT = 3100;

// Cloud sessions ship a Chromium build that may not match this Playwright
// version. Point PLAYWRIGHT_CHROMIUM_PATH at it (e.g. /opt/pw-browsers/chromium)
// instead of downloading another one. CI leaves it unset and runs
// `playwright install chromium`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        locale: "ar-IQ",
        timezoneId: "Asia/Baghdad",
        launchOptions: { executablePath },
      },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Without an OTPIQ key the app logs login codes; this also writes them
    // where the tests can read them (src/lib/otp/senders.ts).
    // Certificate PDFs (src/lib/certificates/pdf.ts) need a Chromium off
    // Vercel; the server borrows the one the tests run in.
    // A VAPID public key, so the push-permission card shows: the tests stub
    // the browser's subscribe (headless Chromium can't reach a push service)
    // and nothing is ever sent. Only the public half; no private key exists.
    env: {
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY,
      OTP_DEV_OUTBOX: OTP_OUTBOX,
      CERTIFICATE_CHROMIUM_PATH: executablePath ?? chromium.executablePath(),
    },
  },
});
