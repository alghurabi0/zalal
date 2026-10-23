import { useTranslations } from "next-intl";

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
      <svg
        aria-hidden="true"
        viewBox="0 0 100 80"
        fill="none"
        strokeLinecap="round"
        strokeWidth="9"
        className="h-15 w-18.5 stroke-aqua"
      >
        <path d="M8 18 q10.5 -10 21 0 t21 0 t21 0 t21 0" />
        <path d="M8 40 q10.5 -10 21 0 t21 0 t21 0 t21 0" strokeOpacity="0.7" />
        <path d="M8 62 q10.5 -10 21 0 t21 0 t21 0 t21 0" strokeOpacity="0.4" />
      </svg>
    </div>
  );
}
