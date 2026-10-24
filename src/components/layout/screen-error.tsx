"use client";

import { ErrorState } from "@/components/ui/error-state";
import { useReportError } from "@/lib/monitoring/use-report-error";

import { Screen } from "./screen";

/**
 * A screen's error state (spec §5): reports to Sentry and offers
 * "اعد المحاولة". Each route's error.tsx renders it with Next's props.
 */
export function ScreenError({ error, retry }: { error: unknown; retry: () => void }) {
  useReportError(error);
  return (
    <Screen className="justify-center">
      <ErrorState titleAs="h1" onRetry={retry} />
    </Screen>
  );
}
