"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The server's clock, ticking every `everyMs` while `running`: the device's
 * time plus the offset measured when the page's data (read at `readAt`, the
 * server's ms) arrived. Measured once per reading, so a page Next kept
 * hidden and shows again doesn't count its hidden time as clock skew. Null
 * until mounted, since the server can't know the device's clock.
 */
export function useServerNow(readAt: number, everyMs: number, running = true): number | null {
  const [now, setNow] = useState<number | null>(null);
  const measured = useRef<{ readAt: number; offset: number } | null>(null);

  useEffect(() => {
    if (measured.current?.readAt !== readAt) {
      measured.current = { readAt, offset: readAt - Date.now() };
    }
    const { offset } = measured.current;
    const tick = () => setNow(Date.now() + offset);
    const first = window.setTimeout(tick, 0);
    const timer = running ? window.setInterval(tick, everyMs) : undefined;
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [readAt, everyMs, running]);

  return now;
}
