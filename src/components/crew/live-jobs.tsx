"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/browser";

/** How often My jobs reloads its data anyway (see below). */
const POLL_MS = 60_000;

/**
 * Keeps the crew's jobs live (C2, C3): the page's server data is fetched
 * again when one of the crew's orders changes. Realtime applies the orders
 * select policy, so only the crew's rows arrive. A burst of changes reloads
 * once, and a hidden page waits until it is shown again.
 *
 * A job taken away from the crew sends no event (the crew can no longer
 * read the new row), so My jobs (`poll`) also reloads once a minute. Job
 * detail doesn't poll, since each reload signs its media links again (and
 * restarts a playing video); a move on a job that is no longer the crew's
 * is refused and the page then shows that.
 */
export function LiveJobs({ poll = false }: { poll?: boolean }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stale = false;

    const refresh = () => {
      if (document.hidden) {
        stale = true;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 1000);
    };
    const onVisible = () => {
      if (!document.hidden && (stale || poll)) {
        stale = false;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = poll ? window.setInterval(refresh, POLL_MS) : undefined;

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
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, refresh)
        .subscribe();
    })();

    return () => {
      closed = true;
      clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [router, poll]);

  return null;
}
