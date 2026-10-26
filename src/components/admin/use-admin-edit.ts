"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { AdminEditError, AdminEditFailure } from "@/lib/admin/edit-errors";

/**
 * Runs an admin Server Action, refreshes the page and keeps its error. On
 * success `onDone` gets the action's result (counts the screen reports).
 */
export function useAdminEdit() {
  const router = useRouter();
  const [error, setError] = useState<AdminEditError | null>(null);
  const [pending, startTransition] = useTransition();
  const run = <T extends { status: "done" }>(
    action: () => Promise<T | AdminEditFailure>,
    onDone: (result: T) => void,
  ) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.status === "done") onDone(result as T);
      else setError((result as AdminEditFailure).error);
      router.refresh();
    });
  };
  return { error, pending, run };
}
