"use client";

import { useEffect } from "react";

import { syncPush } from "@/lib/push/client";

/**
 * Keeps this browser's push subscription saved under the logged-in account
 * (spec §9.2) on the screens each surface opens on (Home, A1's shell, C2's
 * shell): a phone that changed hands, or a subscription the browser renewed,
 * keeps getting the right account's pushes without asking again.
 */
export function PushSync() {
  useEffect(() => {
    void syncPush();
  }, []);
  return null;
}
