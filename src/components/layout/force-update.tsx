"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { APP_VERSION, compareVersions } from "@/lib/app-version";
import { createClient } from "@/lib/supabase/browser";

import { SystemState } from "./system-state";

type Required = { phone: string | null };

/**
 * N16 force update, on every surface (the root layout renders it). An open
 * tab keeps running the build it loaded, so the check runs here: when this
 * build's version is below settings.min_app_version (A13), a full-screen
 * "حدّث التطبيق" covers the app. It checks on load and whenever the app
 * comes back to the foreground. A failed read shows nothing.
 */
export function ForceUpdate() {
  const t = useTranslations("System");
  const [required, setRequired] = useState<Required | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const { data } = await createClient()
        .from("settings")
        .select("min_app_version, company_phone")
        .single();
      if (cancelled || !data) return;
      setRequired(
        compareVersions(APP_VERSION, data.min_app_version) < 0
          ? { phone: data.company_phone }
          : null,
      );
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!required) return null;

  // The service worker skips waiting (src/app/sw.ts), so fetching the new
  // one and reloading loads the new build.
  const update = async () => {
    setUpdating(true);
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      await registration?.update();
    } catch {
      // Reloading still loads the new pages from the network.
    }
    window.location.reload();
  };

  return (
    <div
      role="alertdialog"
      aria-modal
      aria-labelledby="force-update-title"
      className="fixed inset-0 z-50"
    >
      <SystemState
        icon={RefreshCw}
        title={t("updateTitle")}
        titleId="force-update-title"
        body={t("updateBody")}
        phone={required.phone}
        callLabel={t("call")}
        action={
          <Button onClick={() => void update()} loading={updating}>
            {t("update")}
          </Button>
        }
      />
    </div>
  );
}
