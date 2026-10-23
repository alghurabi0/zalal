import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/**
 * Card surface from the canvas. Padding and inner layout come from
 * `className` because they vary by screen (12–16px). Renders a <Link> when
 * `href` is set, for cards that open another screen.
 */
export type CardVariant = "outline" | "raised" | "dark";

const variantClasses: Record<CardVariant, string> = {
  // White with a border: most cards.
  outline: "border border-border bg-surface text-navy",
  // White with a shadow, no border: the Home live-order card.
  raised: "bg-surface text-navy shadow-card",
  // Navy: subscription card, featured tip.
  dark: "bg-navy text-white focus-visible:outline-aqua",
};

type OwnProps = { variant?: CardVariant; className?: string };

type AsDiv = OwnProps & Omit<ComponentProps<"div">, keyof OwnProps> & { href?: undefined };
type AsLink = OwnProps &
  Omit<ComponentProps<typeof Link>, keyof OwnProps> & {
    href: ComponentProps<typeof Link>["href"];
  };

export type CardProps = AsDiv | AsLink;

export function Card({ variant = "outline", className, ...props }: CardProps) {
  const classes = cn("block rounded-card", variantClasses[variant], className);

  if (props.href !== undefined) {
    return <Link {...(props as Omit<AsLink, keyof OwnProps>)} className={classes} />;
  }
  return <div {...(props as Omit<AsDiv, keyof OwnProps>)} className={classes} />;
}
