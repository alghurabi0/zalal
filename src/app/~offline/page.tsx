import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { LogoTile } from "@/components/brand/logo-tile";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Offline");
  return { title: t("title") };
}

// The service worker shows this page when a page load fails without a
// network (src/app/sw.ts). It is precached at install time, so it must not
// depend on request data. No design exists for it; it follows Welcome
// (Main.dc.html).
export default function OfflinePage() {
  const t = useTranslations("Offline");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-phone flex-col bg-navy text-white">
      <div className="flex flex-1 flex-col items-center justify-center gap-5.5 px-8 text-center">
        <LogoTile />
        <h1 className="text-28 leading-snug font-black">{t("title")}</h1>
        <p className="text-17 text-on-dark-body">{t("body")}</p>
      </div>
      <div className="px-6 pb-10">
        {/* A plain link to the current URL reloads the page the user asked
            for (the service worker serves this page under that URL), and it
            works even if the app's JavaScript isn't cached. */}
        <a
          href=""
          className="flex h-14 items-center justify-center rounded-button bg-aqua text-18 font-extrabold text-navy"
        >
          {t("retry")}
        </a>
      </div>
    </main>
  );
}
