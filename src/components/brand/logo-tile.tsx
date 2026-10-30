import { useTranslations } from "next-intl";

import { LogoMark } from "./logo-mark";

/**
 * The logo tile on Welcome and the offline page: a 112px white tile with the
 * logo, the same as the app icon (public/brand/logo-tile.svg).
 */
export function LogoTile() {
  const t = useTranslations("Brand");

  return (
    <div
      role="img"
      aria-label={t("logoLabel")}
      className="flex size-28 items-center justify-center rounded-30 bg-surface shadow-logo"
    >
      <LogoMark className="w-18" />
    </div>
  );
}
