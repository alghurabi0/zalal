"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Sends an error caught by an error.tsx boundary to Sentry. A boundary
 * catches the error, so Sentry's global handlers never see it; every
 * error.tsx must call this.
 */
export function useReportError(error: unknown) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
}
