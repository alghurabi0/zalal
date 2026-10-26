"use client";

import { MapPinOff, Navigation, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { type Fix, fixOf, SEND_INTERVAL_MS, shouldSend } from "@/lib/crew/location";

import { shareLocation } from "../../actions";

type ShareState = "starting" | "sharing" | "denied" | "unavailable" | "offline" | "failed";

const TICK_MS = 5_000;

/**
 * GPS while on the way (spec §8.1): sends the phone's position at most every
 * 15 s for the customer's Tracking and the admin live map, and keeps the
 * screen awake so it keeps sending. A PWA can't send from the background,
 * so the crew is asked to keep the app open. Stops when the job leaves the
 * way (the page re-renders without it).
 */
export function LocationShare({ orderId }: { orderId: string }) {
  const t = useTranslations("Crew.location");
  const router = useRouter();
  const [state, setState] = useState<ShareState>(() =>
    typeof navigator !== "undefined" && !("geolocation" in navigator) ? "unavailable" : "starting",
  );

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    let latest: Fix | null = null;
    let last: { at: number; fixAt: number } | null = null;
    let sending = false;
    let asking = false;
    let stopped = false;
    let lock: WakeLockSentinel | null = null;

    const send = async () => {
      if (sending || stopped) return;
      const now = Date.now();
      if (!shouldSend(latest, last, now)) return;
      if (!navigator.onLine) {
        setState("offline");
        return;
      }
      const fix = latest;
      sending = true;
      try {
        const result = await shareLocation({
          orderId,
          lat: fix.lat,
          lng: fix.lng,
          accuracyM: fix.accuracyM,
        });
        if (stopped) return;
        if (result.status === "error") {
          if (result.error === "failed") setState("failed");
          else {
            // The job left the way or isn't ours any more: show its new state.
            stopped = true;
            router.refresh();
          }
          return;
        }
        last = { at: now, fixAt: fix.at };
        setState("sharing");
      } catch {
        // The action never reached the server.
        if (!stopped) setState("offline");
      } finally {
        sending = false;
      }
    };

    const onFix = (position: GeolocationPosition) => {
      latest = fixOf(position);
      void send();
    };
    const onError = (error: GeolocationPositionError) => {
      if (stopped) return;
      if (error.code === error.PERMISSION_DENIED) setState("denied");
      else if (!latest) setState("unavailable");
    };
    const options = { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 };
    const watch = navigator.geolocation.watchPosition(onFix, onError, options);

    // Some phones report nothing while the car stands still. Ask for a fresh
    // fix then, so a crew stopped at a light doesn't look lost.
    const timer = window.setInterval(() => {
      if (!asking && (!latest || Date.now() - latest.at >= SEND_INTERVAL_MS)) {
        asking = true;
        navigator.geolocation.getCurrentPosition(
          (position) => {
            asking = false;
            onFix(position);
          },
          (error) => {
            asking = false;
            onError(error);
          },
          { ...options, maximumAge: 0 },
        );
      }
      void send();
    }, TICK_MS);

    const keepAwake = async () => {
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      try {
        lock = await navigator.wakeLock.request("screen");
        if (stopped) void lock.release();
      } catch {
        // Battery saver or an old browser: the banner still asks to keep it open.
      }
    };
    // The browser drops the lock whenever the app is hidden; take it again.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void keepAwake();
      void send();
    };
    const onOnline = () => void send();
    void keepAwake();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watch);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      if (lock) void lock.release();
    };
  }, [orderId, router]);

  const problem = state === "denied" || state === "unavailable" || state === "failed";
  const Icon = state === "offline" ? WifiOff : problem ? MapPinOff : Navigation;
  return (
    <section
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 rounded-card p-4",
        problem ? "bg-warn-bg text-warn-strong" : "bg-navy text-white",
      )}
    >
      <Icon
        aria-hidden
        className={cn("mt-0.5 size-5 shrink-0", problem ? "text-warn-icon" : "text-aqua")}
      />
      <div className="flex flex-col">
        <h2 className="text-15 font-extrabold">{t("keepOpen")}</h2>
        <p
          data-state={state}
          className={cn("text-14", problem ? "text-warn-fg" : "text-on-dark-body")}
        >
          {t(`state.${state}`)}
        </p>
      </div>
    </section>
  );
}
