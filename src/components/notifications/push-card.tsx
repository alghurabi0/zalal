"use client";

import { BellRing } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { enablePush, type PushState, pushState } from "@/lib/push/client";

import { IosInstallSteps } from "./ios-install-steps";

const DISMISSED_KEY = "zl_push_card_dismissed";
// "بعدين" hides the card on this device for a month of bookings.
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISSED_KEY));
    return at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    // Private windows: the card comes back on the next booking.
  }
}

/** What the card shows; null hides it. */
type View = "install" | "ask" | "failed" | "blocked" | "done" | null;

function initialView(state: PushState): View {
  if (state === "install") return "install";
  if (state === "default") return "ask";
  // Unsupported, already on, or refused before: nothing to offer.
  return null;
}

/**
 * The soft push-permission card on Booking success (N5, spec §9.2): the
 * browser's own prompt opens only after "فعّل الإشعارات", never on first open.
 * On an iPhone in Safari it first explains adding the app to the home screen.
 * Hidden when push can't work here, is already on, was refused before, or was
 * dismissed lately.
 */
export function PushCard() {
  const t = useTranslations("Notifications.push");
  const [view, setView] = useState<View>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void pushState().then((state) => {
      if (live && !dismissedRecently()) setView(initialView(state));
    });
    return () => {
      live = false;
    };
  }, []);

  if (!view) return null;

  const dismiss = () => {
    rememberDismissed();
    setView(null);
  };

  const enable = async () => {
    setBusy(true);
    const result = await enablePush();
    setBusy(false);
    setView(result === "subscribed" ? "done" : result === "denied" ? "blocked" : "failed");
  };

  const text = {
    install: t("iosBody"),
    ask: t("body"),
    failed: t("body"),
    blocked: t("denied"),
    done: t("enabled"),
  }[view];

  return (
    <Card
      role="region"
      aria-labelledby="push-card-title"
      className="mb-3 flex w-full flex-col gap-3 p-4 text-start"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-input bg-selected text-teal">
          <BellRing aria-hidden className="size-5.5" strokeWidth={2} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1" aria-live="polite">
          <h2 id="push-card-title" className="text-16 font-extrabold">
            {view === "install" ? t("iosTitle") : t("title")}
          </h2>
          <p className="text-13 leading-relaxed text-muted">{text}</p>
        </div>
      </div>
      {view === "install" && <IosInstallSteps />}
      {view === "failed" && (
        <p role="alert" className="text-13 text-danger">
          {t("failed")}
        </p>
      )}
      {view !== "done" && (
        <div className="flex items-center gap-2">
          {(view === "ask" || view === "failed") && (
            <Button size="sm" loading={busy} onClick={() => void enable()} className="flex-1">
              {t("enable")}
            </Button>
          )}
          <Button size="sm" variant="link" onClick={dismiss} className="ms-auto">
            {t("later")}
          </Button>
        </div>
      )}
    </Card>
  );
}
