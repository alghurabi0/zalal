import { SerwistProvider } from "@serwist/next/react";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";

import { ForceUpdate } from "@/components/layout/force-update";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { locale } from "@/i18n/config";
import { brandColors } from "@/lib/brand";
import { cairo } from "@/lib/fonts";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return {
    applicationName: t("title"),
    title: t("title"),
    description: t("description"),
    // The manifest comes from app/manifest.ts and the icons from app/icon.svg
    // and app/apple-icon.png; Next.js adds their tags. iOS still needs these
    // to run the app full screen from the home screen.
    appleWebApp: { capable: true, title: t("title"), statusBarStyle: "default" },
    // Stops iOS from turning order numbers and prices into phone links.
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  themeColor: brandColors.navy,
  // Lets pages draw under the iPhone home indicator; the tab bar and sheets
  // pad themselves with the pb-safe-* utility (globals.css).
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={locale} dir="rtl" className={cairo.variable}>
      <body className="min-h-dvh">
        {/* Registers public/sw.js, which `pnpm build` creates. Off in dev,
            where there is no worker and caching would get in the way.
            Pages are never cached (src/app/sw.ts), so caching on navigation
            stays off, and coming back online doesn't reload the page, which
            would lose what the user typed. */}
        <SerwistProvider
          swUrl="/sw.js"
          disable={process.env.NODE_ENV === "development"}
          cacheOnNavigation={false}
          reloadOnOnline={false}
        >
          <NextIntlClientProvider>
            <OfflineBanner />
            {children}
            <ForceUpdate />
          </NextIntlClientProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}
