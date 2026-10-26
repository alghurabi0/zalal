"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { Bell, BellOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/browser";

const SOUND_KEY = "zl_admin_sound";

function readSoundPref(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

// Without storage (private windows, blocked site data) the choice lasts for
// this page only.
let fallbackPref = false;
const listeners = new Set<() => void>();

function soundPref(): boolean {
  return readSoundPref() || fallbackPref;
}

function writeSoundPref(on: boolean) {
  fallbackPref = on;
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Kept in fallbackPref.
  }
  listeners.forEach((listener) => listener());
}

function subscribeSoundPref(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** A short two-note chime, made in the browser so no sound file is needed. */
function chime(context: AudioContext) {
  const start = context.currentTime;
  [880, 1320].forEach((frequency, index) => {
    const at = start + index * 0.18;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.17);
  });
}

/**
 * Keeps every admin page live and rings for new bookings (spec §6, §8.2 A1):
 * any order change refetches the page's server data, and a new order plays
 * a chime (while sound is on) and shows a link to it. Push alerts come in
 * Phase 5. Browsers allow sound only after a click on the page, so sound
 * starts off and the admin turns it on; the choice is remembered on this
 * browser.
 */
export function AdminLive() {
  const t = useTranslations("Admin.live");
  const router = useRouter();
  const soundOn = useSyncExternalStore(subscribeSoundPref, soundPref, () => false);
  const [latest, setLatest] = useState<{ id: string; number: number } | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const soundRef = useRef(false);

  const context = useCallback(() => {
    audio.current ??= new AudioContext();
    return audio.current;
  }, []);

  // A remembered "on" needs one click or key press on the page before the
  // browser lets it play.
  useEffect(() => {
    soundRef.current = soundOn;
    if (!soundOn) return;
    const unlock = () => void context().resume();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [context, soundOn]);

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stale = false;
    // A burst of changes (confirm + assign, a crew moving on) refetches once;
    // a hidden tab waits until it is shown again.
    const refresh = () => {
      if (document.hidden) {
        stale = true;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 1000);
    };
    const onVisible = () => {
      if (!document.hidden && stale) {
        stale = false;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    void (async () => {
      // Join with the admin's token, or Realtime treats the channel as a
      // guest and RLS sends nothing (see LiveOrders).
      const { data } = await supabase.auth.getSession();
      if (closed || !data.session) return;
      await supabase.realtime.setAuth(data.session.access_token);
      if (closed) return;
      channel = supabase
        .channel(`admin-orders:${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) => {
          refresh();
          if (payload.eventType !== "INSERT") return;
          const row = payload.new as { id?: unknown; number?: unknown };
          if (typeof row.id === "string" && typeof row.number === "number") {
            setLatest({ id: row.id, number: row.number });
          }
          if (soundRef.current && audio.current?.state === "running") chime(audio.current);
        })
        .subscribe();
    })();

    return () => {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [router]);

  const toggle = () => {
    const next = !soundOn;
    soundRef.current = next;
    writeSoundPref(next);
    if (next) {
      const ctx = context();
      // This click is the gesture the browser needs; the chime confirms it works.
      void ctx.resume().then(() => chime(ctx));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:flex-nowrap lg:items-stretch">
      <button
        type="button"
        aria-pressed={soundOn}
        onClick={toggle}
        className="flex min-h-11 items-center gap-2 rounded-chip px-3 text-14 font-bold text-on-dark-body hover:bg-navy-2 focus-visible:outline-aqua"
      >
        {soundOn ? (
          <Bell aria-hidden className="size-5 shrink-0 text-aqua" />
        ) : (
          <BellOff aria-hidden className="size-5 shrink-0" />
        )}
        {soundOn ? t("soundOn") : t("soundOff")}
      </button>
      <p role="status" className="contents">
        {latest && (
          <Link
            href={routes.adminOrder(latest.id)}
            onClick={() => setLatest(null)}
            className="flex min-h-11 items-center rounded-chip bg-aqua px-3 text-14 font-extrabold text-navy focus-visible:outline-white"
          >
            {/* One text box: a flex item would drop the space before the number. */}
            <span>
              {t.rich("newOrder", {
                number: latest.number,
                num: (chunks) => <span dir="ltr">{chunks}</span>,
              })}
            </span>
          </Link>
        )}
      </p>
    </div>
  );
}
