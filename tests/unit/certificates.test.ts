import { describe, expect, it, vi } from "vitest";

import { textDir } from "@/lib/bidi";
import {
  certificateNumber,
  maskPhone,
  normalizePublicCode,
  ticketNumber,
} from "@/lib/certificates/format";
import { printOrigin, publicOrigin } from "@/lib/certificates/origins";
import {
  createPrintToken,
  PRINT_TOKEN_TTL_MS,
  verifyPrintToken,
} from "@/lib/certificates/print-token";
import type { CertificateEnv } from "@/lib/env.server";
import { rateOrderSchema } from "@/lib/schemas/rating";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn() }));

describe("certificate labels", () => {
  it("numbers the certificate after its order and tickets with ZL-T", () => {
    expect(certificateNumber(1024)).toBe("ZL-1024");
    expect(ticketNumber(1001)).toBe("ZL-T-1001");
  });

  it("masks the phone as the PDF shows it", () => {
    expect(maskPhone("+9647801234567")).toBe("0780 ••• 4567");
    expect(maskPhone("not a phone")).toBe("•••");
  });

  it("accepts a public code in any case, and only the code alphabet", () => {
    expect(normalizePublicCode(" h3jw3nk9 ")).toBe("H3JW3NK9");
    expect(normalizePublicCode("ABCD0123")).toBeNull(); // 0 and 1 are never used
    expect(normalizePublicCode("ABCDEFGHI")).toBeNull();
    expect(normalizePublicCode("ABCDEFG")).toBeNull();
    expect(normalizePublicCode("ABCD%2F..")).toBeNull();
  });

  it("keeps numeric ranges left to right inside Arabic lines", () => {
    expect(textDir("1,000–2,000")).toBe("ltr");
    expect(textDir("لحد 1,000 لتر")).toBe("rtl");
  });
});

describe("print token", () => {
  const secret = "test-secret";
  const id = "6f1d2c1e-0000-4000-8000-000000000001";
  const now = 1_790_000_000_000;

  it("lets the headless browser in for that certificate only, for 5 minutes", () => {
    const token = createPrintToken(secret, id, now);
    expect(verifyPrintToken(secret, id, token, now)).toBe(true);
    expect(verifyPrintToken(secret, id, token, now + PRINT_TOKEN_TTL_MS)).toBe(true);
    expect(verifyPrintToken(secret, id, token, now + PRINT_TOKEN_TTL_MS + 1)).toBe(false);
    expect(verifyPrintToken(secret, "6f1d2c1e-0000-4000-8000-000000000002", token, now)).toBe(
      false,
    );
    expect(verifyPrintToken("other-secret", id, token, now)).toBe(false);
  });

  it("refuses a missing, malformed, altered or far-future token", () => {
    const token = createPrintToken(secret, id, now);
    const [expiry, signature] = token.split(".");
    expect(verifyPrintToken(secret, id, undefined, now)).toBe(false);
    expect(verifyPrintToken(secret, id, "garbage", now)).toBe(false);
    expect(verifyPrintToken(secret, id, `${Number(expiry) + 1}.${signature}`, now)).toBe(false);
    const later = createPrintToken(secret, id, now + 60 * 60 * 1000);
    expect(verifyPrintToken(secret, id, later, now)).toBe(false);
  });
});

describe("certificate origins", () => {
  const env = (values: Partial<CertificateEnv>): CertificateEnv => values;

  it("prints from this deployment on Vercel, whatever the request says", () => {
    const vercel = env({ VERCEL_ENV: "preview", VERCEL_URL: "zalal-abc.vercel.app" });
    expect(printOrigin(vercel, "evil.example", "https")).toBe("https://zalal-abc.vercel.app");
  });

  it("off Vercel, prints only from a local host", () => {
    expect(printOrigin(env({}), "localhost:3100", null)).toBe("http://localhost:3100");
    expect(printOrigin(env({}), "127.0.0.1:3000", "http")).toBe("http://127.0.0.1:3000");
    expect(printOrigin(env({}), "evil.example", "https")).toBeNull();
    expect(printOrigin(env({}), "localhost.evil.example", "https")).toBeNull();
    expect(printOrigin(env({}), null, null)).toBeNull();
  });

  it("links the QR code to the production domain in production", () => {
    expect(
      publicOrigin(
        env({
          VERCEL_ENV: "production",
          VERCEL_URL: "zalal-abc.vercel.app",
          VERCEL_PROJECT_PRODUCTION_URL: "zalal.iq",
        }),
        "zalal-abc.vercel.app",
        "https",
      ),
    ).toBe("https://zalal.iq");
    expect(
      publicOrigin(env({ VERCEL_ENV: "preview", VERCEL_URL: "zalal-abc.vercel.app" }), null, null),
    ).toBe("https://zalal-abc.vercel.app");
    expect(publicOrigin(env({}), "localhost:3100", "http")).toBe("http://localhost:3100");
  });
});

describe("rateOrderSchema", () => {
  const orderId = "6f1d2c1e-0000-4000-8000-000000000001";

  it("takes 1–5 stars, the company tags once each and a trimmed comment", () => {
    expect(
      rateOrderSchema.parse({
        orderId,
        stars: 2,
        tags: ["on_time", "clear_photos", "on_time"],
        comment: "  تأخروا  ",
      }),
    ).toEqual({ orderId, stars: 2, tags: ["on_time", "clear_photos"], comment: "تأخروا" });
    expect(rateOrderSchema.parse({ orderId, stars: 5, tags: [], comment: "   " }).comment).toBe(
      null,
    );
  });

  it("refuses what rate_order would", () => {
    for (const stars of [0, 6, 2.5]) {
      expect(rateOrderSchema.safeParse({ orderId, stars, tags: [], comment: "" }).success).toBe(
        false,
      );
    }
    expect(
      rateOrderSchema.safeParse({ orderId, stars: 4, tags: ["video_clear"], comment: "" }).success,
    ).toBe(false);
    expect(
      rateOrderSchema.safeParse({ orderId, stars: 4, tags: [], comment: "ك".repeat(501) }).success,
    ).toBe(false);
  });
});
