"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOptimistic, useState, useTransition } from "react";

import { Switch } from "@/components/ui/switch";

import { setReminders } from "./actions";

/**
 * Profile's reminder toggle (Profile.dc.html, spec §5.8). Flips at once and
 * goes back, with a message, if the save fails.
 */
export function RemindersSwitch({ enabled }: { enabled: boolean }) {
  const t = useTranslations("Profile");
  const [saved, setSaved] = useState(enabled);
  const [shown, setShown] = useOptimistic(saved);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    setFailed(false);
    startTransition(async () => {
      setShown(next);
      const { ok } = await setReminders(next);
      if (ok) setSaved(next);
      else setFailed(true);
    });
  };

  return (
    <div className="px-4">
      <Switch checked={shown} onChange={(event) => toggle(event.target.checked)}>
        <span className="flex items-center gap-3">
          <Bell aria-hidden className="size-6 shrink-0 text-teal" strokeWidth={2} />
          <span className="text-17 font-extrabold">{t("reminders")}</span>
        </span>
      </Switch>
      <p aria-live="polite" className={failed ? "pb-3 text-14 font-bold text-danger" : "sr-only"}>
        {failed ? t("remindersFailed") : null}
      </p>
    </div>
  );
}
