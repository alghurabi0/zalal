"use client";

import { CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Button } from "./button";
import { EmptyState } from "./empty-state";

type ErrorStateProps = {
  /** Defaults to "صار خطأ". */
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

/** The error state every screen needs (spec §5), with "اعد المحاولة". */
export function ErrorState({ title, description, onRetry, titleAs, className }: ErrorStateProps) {
  const t = useTranslations("UI");

  return (
    <EmptyState
      tone="danger"
      icon={CircleAlert}
      title={title ?? t("errorTitle")}
      description={description ?? t("errorBody")}
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
