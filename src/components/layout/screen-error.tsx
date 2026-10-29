"use client";

import { useEffect, useRef } from "react";

import { ErrorState } from "@/components/ui/error-state";
import { useReportError } from "@/lib/monitoring/use-report-error";
import { useOnline } from "@/lib/use-online";

import { Screen } from "./screen";

/**
 * A screen's error state (spec §5): reports to Sentry and offers
 * "اعد المحاولة". While offline it is the offline state, and it tries again
 * by itself once the network is back. Each route's error.tsx renders it
 * with Next's props.
 */
export function ScreenError({ error, retry }: { error: unknown; retry: () => void }) {
  useReportError(error);
  useRetryWhenOnline(retry);
  return (
    <Screen className="justify-center">
      <ErrorState titleAs="h1" onRetry={retry} />
    </Screen>
  );
}

/** Calls `retry` when the browser goes from offline back to online. */
export function useRetryWhenOnline(retry: () => void) {
  const online = useOnline();
  const wasOffline = useRef(!online);
  useEffect(() => {
    if (!online) wasOffline.current = true;
    else if (wasOffline.current) {
      wasOffline.current = false;
      retry();
    }
  }, [online, retry]);
}
