import { ChevronLeft } from "lucide-react";
import type Link from "next/link";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";

import { IconButton, type IconButtonVariant } from "./icon-button";

type BackButtonProps = {
  href: ComponentProps<typeof Link>["href"];
  /** surface on light screens, floating on the map, dark on navy headers, soft in the chat header. */
  variant?: IconButtonVariant;
  className?: string;
};

/** The "رجوع" button at the top of most screens. */
export function BackButton({ href, variant = "surface", className }: BackButtonProps) {
  const t = useTranslations("UI");

  return (
    <IconButton
      href={href}
      label={t("back")}
      icon={ChevronLeft}
      variant={variant}
      // "Back" points to the start side: right in RTL, left in LTR.
      iconClassName="rtl:-scale-x-100"
      className={className}
    />
  );
}
