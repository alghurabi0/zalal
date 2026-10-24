import path from "node:path";

/**
 * Where the app writes login codes during e2e runs (OTP_DEV_OUTBOX,
 * src/lib/otp/senders.ts). playwright.config.ts passes it to the server.
 */
export const OTP_OUTBOX = path.resolve("test-results/otp-outbox");
