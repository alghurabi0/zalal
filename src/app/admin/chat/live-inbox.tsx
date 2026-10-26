"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { usePostgresChanges } from "@/lib/supabase/use-postgres-changes";

/**
 * Keeps the inbox list live (A4): any thread that gets a message or is read
 * refetches the page's server data, at most once a second.
 */
export function LiveInbox() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  usePostgresChanges({
    table: "chat_threads",
    events: ["INSERT", "UPDATE"],
    onChange: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 1000);
    },
  });
  return null;
}
