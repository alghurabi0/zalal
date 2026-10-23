"use client";

import { NextIntlClientProvider } from "next-intl";

import { ErrorState } from "@/components/ui/error-state";
import { locale, timeZone } from "@/i18n/config";
import { cairo } from "@/lib/fonts";
import { useReportError } from "@/lib/monitoring/use-report-error";

import messages from "../../messages/ar.json";

import "./globals.css";

// Shown when the root layout itself fails. It replaces that layout, so it
// brings its own <html>, font, styles and translations.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useReportError(error);

  return (
    <html lang={locale} dir="rtl" className={cairo.variable}>
      <body className="min-h-dvh">
        <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={{ UI: messages.UI }}>
          <title>{messages.Metadata.title}</title>
          <main className="mx-auto flex min-h-dvh w-full max-w-phone flex-col justify-center">
            <ErrorState titleAs="h1" onRetry={retry} />
          </main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
