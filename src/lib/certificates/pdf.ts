import "server-only";

import * as Sentry from "@sentry/nextjs";
import type { Browser } from "puppeteer-core";

import { publicEnv } from "@/lib/env";
import { certificateEnv, serverEnv } from "@/lib/env.server";
import { ANALYTICS_PATH, ERRORS_PATH } from "@/lib/monitoring/paths";
import { routes } from "@/lib/routes";
import { createAdminClient } from "@/lib/supabase/admin";

import { createPrintToken, PRINT_TOKEN_COOKIE } from "./print-token";

// The certificate PDF (spec §3, §10.1): headless Chromium opens the print
// page and prints it, so Arabic is shaped by a real browser with the Cairo
// font. It is made once per issue and stored in the private `certificates`
// bucket at <certificate id>/<version>.pdf, where the version is the issue
// time: completing an order again (after an override) issues a new version.
//
// It runs right after the crew completes the job (after() in the crew's
// Server Action) and, when a PDF is missing, on the first download.

/** No Chromium to make the PDF with (off Vercel without CERTIFICATE_CHROMIUM_PATH). */
export class PdfUnavailableError extends Error {
  constructor() {
    super("No Chromium for certificate PDFs: set CERTIFICATE_CHROMIUM_PATH");
    this.name = "PdfUnavailableError";
  }
}

async function launchBrowser(): Promise<Browser> {
  const env = certificateEnv();
  const { default: puppeteer } = await import("puppeteer-core");
  if (env.CERTIFICATE_CHROMIUM_PATH) {
    // Like Playwright, without Chromium's sandbox, which fails as root and in
    // many containers. The page is our own and every other request is
    // blocked (renderPdf).
    return puppeteer.launch({
      executablePath: env.CERTIFICATE_CHROMIUM_PATH,
      headless: true,
      args: ["--no-sandbox"],
    });
  }
  if (env.VERCEL_ENV) {
    const { default: chromium } = await import("@sparticuz/chromium");
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
    });
  }
  throw new PdfUnavailableError();
}

/** Prints the page for one certificate. `origin` is this deployment (origins.ts). */
async function renderPdf(certificateId: string, origin: string): Promise<Uint8Array> {
  const env = certificateEnv();
  const token = createPrintToken(serverEnv().SUPABASE_SECRET_KEY, certificateId, Date.now());
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123 });
    const site = new URL(origin);
    await browser.setCookie({
      name: PRINT_TOKEN_COOKIE,
      value: token,
      domain: site.hostname,
      path: "/",
      secure: site.protocol === "https:",
      httpOnly: true,
      sameSite: "Strict",
    });
    // Our own requests carry the Vercel protection bypass; the photos come
    // from Supabase Storage. Analytics, error reporting, the service worker
    // and anything else are dropped, so the token page is recorded nowhere.
    const supabaseOrigin = new URL(publicEnv().NEXT_PUBLIC_SUPABASE_URL).origin;
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === origin) {
        if (
          url.pathname.startsWith(ANALYTICS_PATH) ||
          url.pathname.startsWith(ERRORS_PATH) ||
          url.pathname === "/sw.js"
        ) {
          void request.abort();
          return;
        }
        const headers = { ...request.headers() };
        if (env.VERCEL_AUTOMATION_BYPASS_SECRET) {
          headers["x-vercel-protection-bypass"] = env.VERCEL_AUTOMATION_BYPASS_SECRET;
        }
        void request.continue({ headers });
      } else if (url.origin === supabaseOrigin && url.pathname.startsWith("/storage/")) {
        void request.continue();
      } else if (url.protocol === "data:") {
        void request.continue();
      } else {
        void request.abort();
      }
    });

    const response = await page.goto(`${origin}${routes.certificatePrint(certificateId)}`, {
      waitUntil: "networkidle0",
      timeout: 30_000,
    });
    if (!response?.ok()) throw new Error(`Print page answered ${response?.status() ?? "nothing"}`);
    await page.waitForSelector("[data-certificate]", { timeout: 10_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return await page.pdf({
      // A4 without margins: the page pads itself.
      format: "A4",
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      printBackground: true,
      pageRanges: "1",
    });
  } finally {
    // Chromium sometimes hangs on close in serverless functions.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      browser.close(),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 5_000);
      }),
    ]);
    clearTimeout(timer);
  }
}

/**
 * The stored PDF's path, made first if missing. Null when the order isn't
 * completed (no certificate to print). Safe to run twice at once: both write
 * the same version, and only a record for the current issue is kept; a run
 * that finds the certificate issued again meanwhile deletes its own file.
 */
export async function ensureCertificatePdf(
  certificateId: string,
  origin: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data: certificate, error } = await admin
    .from("certificates")
    .select("id, issued_at, pdf_path, orders!inner(status)")
    .eq("id", certificateId)
    .eq("orders.status", "completed")
    .maybeSingle();
  if (error) throw new Error(`Certificate read failed: ${error.message}`);
  if (!certificate) return null;
  if (certificate.pdf_path) return certificate.pdf_path;

  const pdf = await renderPdf(certificate.id, origin);
  const path = `${certificate.id}/${Date.parse(certificate.issued_at)}.pdf`;
  const bucket = admin.storage.from("certificates");
  const upload = await bucket.upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (upload.error) throw new Error(`PDF upload failed: ${upload.error.message}`);

  // Recorded only if the certificate wasn't issued again meanwhile.
  const { data: recorded, error: recordError } = await admin
    .from("certificates")
    .update({ pdf_path: path })
    .eq("id", certificate.id)
    .eq("issued_at", certificate.issued_at)
    .select("pdf_path")
    .maybeSingle();
  if (recordError) {
    // Refused (the account was deleted while printing, migration
    // account_deletion) or failed: the file must not stay behind.
    await bucket.remove([path]);
    throw new Error(`PDF record failed: ${recordError.message}`);
  }
  if (!recorded) {
    // Issued again while printing: this version is stale already, and the
    // new issue's run may have cleaned the folder before it landed.
    await bucket.remove([path]);
    return ensureCertificatePdf(certificateId, origin);
  }

  // Earlier versions are no longer readable (the policy follows pdf_path).
  const { data: files } = await bucket.list(certificate.id);
  const stale = (files ?? [])
    .map((file) => `${certificate.id}/${file.name}`)
    .filter((name) => name !== path);
  if (stale.length > 0) await bucket.remove(stale);
  return path;
}

/**
 * After the crew completes a job: makes the new certificate's PDF, so the
 * customer's first download doesn't wait for Chromium. Failures only go to
 * Sentry; the download makes the PDF if it is still missing.
 */
export async function makePdfAfterCompletion(orderId: string, origin: string | null) {
  try {
    if (!origin) throw new Error("No origin to print the certificate from");
    const { data, error } = await createAdminClient()
      .from("certificates")
      .select("id")
      .eq("order_id", orderId)
      .maybeSingle();
    if (error) throw new Error(`Certificate read failed: ${error.message}`);
    if (data) await ensureCertificatePdf(data.id, origin);
  } catch (pdfError) {
    if (pdfError instanceof PdfUnavailableError) return;
    Sentry.captureException(pdfError);
  }
}
