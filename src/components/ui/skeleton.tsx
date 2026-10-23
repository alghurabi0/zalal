import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A grey placeholder block. Size and shape come from `className`
 * (e.g. "h-24 rounded-card"). Hidden from screen readers; wrap a screen's
 * skeletons in SkeletonGroup, which announces "جاري التحميل" once.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("rounded-chip bg-border motion-safe:animate-pulse", className)}
    />
  );
}

/** The loading state of a screen or section: its skeletons plus a status. */
export function SkeletonGroup({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("UI");

  return (
    <div role="status" className={className}>
      <span className="sr-only">{t("loading")}</span>
      {children}
    </div>
  );
}
