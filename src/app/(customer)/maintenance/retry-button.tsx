"use client";

import { Button } from "@/components/ui/button";

/** Reloads the page the customer opened, which shows it again once maintenance ends. */
export function RetryButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" onClick={() => window.location.reload()}>
      {label}
    </Button>
  );
}
