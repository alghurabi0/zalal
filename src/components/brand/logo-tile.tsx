import { useTranslations } from "next-intl";

import { LogoMark } from "./logo-mark";

/**
 * The logo tile from Welcome (Main.dc.html): a 112px navy-2 tile with the
 * three-wave mark. The same mark is in public/brand/logo.svg.
 */
export function LogoTile() {
  const t = useTranslations("Brand");

  return (
    <div
      role="img"
      aria-label={t("logoLabel")}
      className="flex size-28 items-center justify-center rounded-30 bg-navy-2 shadow-logo"
    >
      <LogoMark className="h-15 w-18.5" />
    </div>
  );
}
