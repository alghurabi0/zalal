"use client";

import { WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * The "ماكو انترنيت" bar at the top of the screen (spec §5), shown while
 * the browser reports no network. The root layout renders it once for
 * every surface. The status region is always present so screen readers
 * announce the change.
 */
export function OfflineBanner() {
  const t = useTranslations("UI");
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    // The server and the first client render assume online.
    () => true,
  );

  return (
    <div role="status" className="sticky top-0 z-40">
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-warn-bg px-4 py-2 text-13 font-extrabold text-warn-fg">
          <WifiOff aria-hidden className="size-4 text-warn-icon" strokeWidth={2.4} />
          {t("offline")}
        </div>
      )}
    </div>
  );
}
