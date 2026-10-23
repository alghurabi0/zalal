import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Text button from the canvas. Renders a <button>, or a Next.js <Link> when
 * `href` is set. Layout (width, flex-1) comes from `className`.
 */
export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "link";
/** Heights: lg 56, footer 54, md 52, card 48 (inside cards), sm 44. */
export type ButtonSize = "lg" | "footer" | "md" | "card" | "sm";

const variantClasses: Record<ButtonVariant, string> = {
  // Navy, the default call to action.
  primary: "bg-navy font-extrabold text-white",
  // Aqua on navy screens (Welcome).
  accent: "bg-aqua font-extrabold text-navy focus-visible:outline-aqua",
  // White with a border, next to a primary button (مساعدة, مشاركة).
  secondary: "border border-border bg-surface font-bold text-navy",
  // White text on navy screens (تصفح بدون تسجيل).
  ghost: "font-bold text-white focus-visible:outline-aqua",
  // Teal text (تخطي, قراءة الكل).
  link: "font-extrabold text-teal",
};

const sizeClasses: Record<ButtonSize, string> = {
  lg: "h-14 rounded-button px-6 text-18",
  footer: "h-13.5 rounded-button px-4.5 text-17",
  md: "h-13 rounded-button px-4 text-16",
  card: "h-12 rounded-input px-4 text-16",
  sm: "h-11 rounded-chip px-3.5 text-14",
};

// The canvas's disabled button: grey fill, muted text (Login, OTP).
const disabledClasses = "cursor-not-allowed border-transparent bg-disabled text-muted";

type OwnProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks clicks, e.g. while a Server Action runs. */
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

type AsButton = OwnProps &
  Omit<ComponentProps<"button">, keyof OwnProps> & {
    href?: undefined;
  };

type AsLink = OwnProps &
  Omit<ComponentProps<typeof Link>, keyof OwnProps> & {
    href: ComponentProps<typeof Link>["href"];
  };

export type ButtonProps = AsButton | AsLink;

export function buttonClasses({
  variant = "primary",
  size = "lg",
  disabled = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
}) {
  return cn(
    "relative inline-flex shrink-0 items-center justify-center gap-2 text-center whitespace-nowrap select-none",
    sizeClasses[size],
    variantClasses[variant],
    disabled &&
      (variant === "link" || variant === "ghost"
        ? "cursor-not-allowed opacity-50"
        : disabledClasses),
    className,
  );
}

export function Button({
  variant,
  size,
  loading = false,
  disabled = false,
  className,
  children,
  ...props
}: ButtonProps) {
  // A loading button keeps its colors; only a disabled one turns grey.
  const classes = buttonClasses({ variant, size, disabled: disabled && !loading, className });
  const content = loading ? (
    <>
      {/* The label stays in the accessible name (opacity, not visibility). */}
      <span className="opacity-0">{children}</span>
      <LoaderCircle aria-hidden className="absolute size-5.5 motion-safe:animate-spin" />
    </>
  ) : (
    children
  );

  if (props.href !== undefined && !disabled && !loading) {
    return (
      <Link {...(props as Omit<AsLink, keyof OwnProps>)} className={classes}>
        {content}
      </Link>
    );
  }

  // A disabled or loading link becomes a disabled button: links can't be
  // disabled.
  const { href, type = "button", ...buttonProps } = props as Omit<AsButton, keyof OwnProps>;
  void href;
  return (
    <button
      {...buttonProps}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
    >
      {content}
    </button>
  );
}
