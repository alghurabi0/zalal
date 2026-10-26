"use client";

import { MapPinOff, Navigation, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";
import { type Fix, fixOf, SEND_INTERVAL_MS, shouldSend } from "@/lib/crew/location";

import { shareLocation } from "./actions";

type ShareState = "starting" | "sharing" | "denied" | "unavailable" | "offline" | "failed";

const TICK_MS = 5_000;

const noSubscription = () => () => {};

/**
 * GPS while on the way (spec §8.1): sends the phone's position at most every
 * 15 s for each of `orderIds` (the crew's jobs on the way, usually one), for
 * the customer's Tracking and the admin live map, and keeps the screen
 * awake so it keeps sending. It sits in the crew layout, so it runs on every
 * crew screen. A PWA can't send from the background, so a bar on top asks
 * the crew to keep the app open.
 */
export function LocationShare({ orderIds }: { orderIds: string[] }) {
  const t = useTranslations("Crew.location");
  const router = useRouter();
  const [shareState, setState] = useState<ShareState>("starting");
  // True on the server and during hydration, so both render the same bar.
  const hasGps = useSyncExternalStore(
    noSubscription,
    () => "geolocation" in navigator,
    () => true,
  );
  const state: ShareState = hasGps ? shareState : "unavailable";
  // A string, so a refresh that brings the same jobs doesn't restart GPS.
  const idsKey = orderIds.join(",");

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const ids = idsKey.split(",");
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
        const results = await Promise.all(
          ids.map((orderId) =>
            shareLocation({ orderId, lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM }),
          ),
        );
        if (stopped) return;
        if (results.some((r) => r.status === "error" && r.error !== "failed")) {
          // A job left the way or isn't ours any more: read the jobs again.
          stopped = true;
          router.refresh();
          return;
        }
        if (results.some((r) => r.status === "error")) {
          setState("failed");
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
        // Battery saver or an old browser: the bar still asks to keep it open.
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
  }, [idsKey, router]);

  const problem = state === "denied" || state === "unavailable" || state === "failed";
  const Icon = state === "offline" ? WifiOff : problem ? MapPinOff : Navigation;
  return (
    <section
      aria-live="polite"
      aria-label={t("keepOpen")}
      className={cn(
        "sticky top-0 z-30 mx-auto flex w-full max-w-phone items-start gap-3 px-5 py-3",
        problem ? "bg-warn-bg text-warn-strong" : "bg-navy text-white",
      )}
    >
      <Icon
        aria-hidden
        className={cn("mt-0.5 size-5 shrink-0", problem ? "text-warn-icon" : "text-aqua")}
      />
      <div className="flex flex-col">
        <p className="text-15 font-extrabold">{t("keepOpen")}</p>
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
