"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/browser";

/** How often the page reloads its data anyway (see below). */
const POLL_MS = 60_000;

/**
 * Keeps the crew's jobs live (C2, C3): the page's server data is fetched
 * again when one of the crew's orders changes. Realtime applies the orders
 * select policy, so only the crew's rows arrive. A job taken away from the
 * crew doesn't arrive (the crew can no longer read the new row), so the page
 * also reloads when it comes back to the screen and once a minute.
 */
export function LiveJobs() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let closed = false;

    void (async () => {
      // Realtime needs the user's token, or it treats the channel as a guest.
      const { data } = await supabase.auth.getSession();
      if (closed || !data.session) return;
      await supabase.realtime.setAuth(data.session.access_token);
      if (closed) return;
      // A topic of its own: C2 and C3 can both be mounted (Next keeps
      // visited pages alive), and one leaving must not close the other's.
      channel = supabase
        .channel(`crew-jobs:${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () =>
          router.refresh(),
        )
        .subscribe();
    })();

    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);

    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
