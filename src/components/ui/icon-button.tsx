import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/**
 * The canvas's 44×44 round icon button. `label` is required: it is the
 * button's accessible name (spec: an Arabic aria-label on icon-only
 * buttons). Renders a <Link> when `href` is set.
 */
export type IconButtonVariant = "surface" | "floating" | "dark" | "soft" | "primary";

const variantClasses: Record<IconButtonVariant, string> = {
  // White with a border: back buttons on light screens.
  surface: "border border-border bg-surface text-navy",
  // White with a shadow: controls floating over the map.
  floating: "bg-surface text-navy shadow-float",
  // On navy headers (Home bell, certificate header).
  dark: "bg-navy-2 text-white focus-visible:outline-aqua",
  // Grey, no border (chat header, attach).
  soft: "bg-bg text-navy",
  // Navy with an aqua glyph (send).
  primary: "bg-navy text-aqua",
};

// The unread dot gets a ring in the button's own color so it reads as cut out.
const dotRing: Record<IconButtonVariant, string> = {
  surface: "border-surface",
  floating: "border-surface",
  dark: "border-navy-2",
  soft: "border-bg",
  primary: "border-navy",
};

type OwnProps = {
  /** Accessible name, e.g. "رجوع" or "الإشعارات، 2 جديدة". */
  label: string;
  icon: LucideIcon;
  variant?: IconButtonVariant;
  /** Amber unread dot (Home bell). Say so in `label` too. */
  dot?: boolean;
  /** Extra classes for the glyph, e.g. to flip it for RTL. */
  iconClassName?: string;
  className?: string;
};

type AsButton = OwnProps &
  Omit<ComponentProps<"button">, keyof OwnProps | "children"> & { href?: undefined };
type AsLink = OwnProps &
  Omit<ComponentProps<typeof Link>, keyof OwnProps | "children"> & {
    href: ComponentProps<typeof Link>["href"];
  };

export type IconButtonProps = AsButton | AsLink;

export function IconButton(props: IconButtonProps) {
  const {
    label,
    icon: Icon,
    variant = "surface",
    dot = false,
    iconClassName,
    className,
    ...rest
  } = props;
  const classes = cn(
    "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50",
    variantClasses[variant],
    className,
  );
  const content = (
    <>
      <Icon aria-hidden className={cn("size-5", iconClassName)} strokeWidth={2} />
      {dot && (
        <span
          aria-hidden
          className={cn(
            "absolute end-2.25 top-2 size-2.5 rounded-full border-2 bg-warn",
            dotRing[variant],
          )}
        />
      )}
    </>
  );

  if (rest.href !== undefined) {
    return (
      <Link {...(rest as Omit<AsLink, keyof OwnProps>)} aria-label={label} className={classes}>
        {content}
      </Link>
    );
  }

  const { type = "button", ...buttonProps } = rest as Omit<AsButton, keyof OwnProps>;
  return (
    <button {...buttonProps} type={type} aria-label={label} className={classes}>
      {content}
    </button>
  );
}
