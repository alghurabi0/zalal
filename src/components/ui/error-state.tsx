"use client";

import { CircleAlert, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { useOnline } from "@/lib/use-online";

import { Button } from "./button";
import { EmptyState } from "./empty-state";

type ErrorStateProps = {
  /** Defaults to "صار خطأ", or "ماكو انترنيت" while offline. */
  title?: ReactNode;
  description?: ReactNode;
  /**
   * What "اعد المحاولة" does. In an error.tsx boundary pass Next's
   * `retry`. Defaults to reloading the page.
   */
  onRetry?: () => void;
  titleAs?: "h1" | "h2";
  className?: string;
};

/**
 * The error state every screen needs (spec §5), with "اعد المحاولة". While
 * the browser is offline it is the offline state instead ("ماكو انترنيت"),
 * unless the screen passes its own title.
 */
export function ErrorState({ title, description, onRetry, titleAs, className }: ErrorStateProps) {
  const t = useTranslations("UI");
  const offline = !useOnline() && title === undefined;

  return (
    <EmptyState
      tone="danger"
      icon={offline ? WifiOff : CircleAlert}
      title={title ?? t(offline ? "offlineTitle" : "errorTitle")}
      description={description ?? t(offline ? "offlineBody" : "errorBody")}
      titleAs={titleAs}
      className={className}
      action={
        <Button
          size="footer"
          className="w-full"
          onClick={onRetry ?? (() => window.location.reload())}
        >
          {t("retry")}
        </Button>
      }
    />
  );
}
