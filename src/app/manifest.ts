import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";

import { locale } from "@/i18n/request";
import { brandColors } from "@/lib/brand";

// One manifest for all three surfaces: crew and admin also start at "/",
// and the role on the account picks the surface after login (spec §2).
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations({ locale, namespace: "Metadata" });

  return {
    id: "/",
    name: t("title"),
    short_name: t("title"),
    description: t("description"),
    lang: locale,
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Navy matches the Welcome screen and the Home header, so the splash
    // screen and status bar blend into the first screen.
    background_color: brandColors.navy,
    theme_color: brandColors.navy,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
