"use client";

import { ErrorState } from "@/components/ui/error-state";
import { useReportError } from "@/lib/monitoring/use-report-error";

// Catches what a screen's own error.tsx doesn't. Screens should still show
// their error state in place (spec §5); this keeps the root layout (offline
// banner, service worker) and offers "اعد المحاولة".
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  useReportError(error);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-phone flex-col justify-center">
      <ErrorState titleAs="h1" onRetry={retry} />
    </main>
  );
}
