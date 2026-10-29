"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { APP_VERSION, compareVersions } from "@/lib/app-version";
import { companyPhones } from "@/lib/phone";
import { routes } from "@/lib/routes";

import { SystemState } from "./system-state";

type Required = { phones: string[] };

/**
 * N16 force update, on every surface (the root layout renders it). An open
 * tab keeps running the build it loaded, so the check runs here: when this
 * build's version is below settings.min_app_version (A13), a full-screen
 * "حدّث التطبيق" covers the app. It checks on load and whenever the app
 * comes back to the foreground. A failed read shows nothing. Never on the
 * dashboard (A13 is where a wrong minimum gets fixed) or the certificate
 * print page (headless Chromium prints it).
 */
/** Read at check time: usePathname() in the root layout would block prerendering. */
function exempt(pathname: string): boolean {
  return pathname.startsWith(routes.admin) || pathname.startsWith("/certificates/");
}

export function ForceUpdate() {
  const t = useTranslations("System");
  const [required, setRequired] = useState<Required | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (exempt(window.location.pathname)) {
        setRequired(null);
        return;
      }
      // Loaded here, not imported: supabase-js would otherwise be in the
      // first load of every page, guests' included (Phase 6, task 4).
      const { createClient } = await import("@/lib/supabase/browser");
      const { data } = await createClient()
        .from("settings")
        .select("min_app_version, company_phone, company_phone_2")
        .single();
      if (cancelled || !data) return;
      setRequired(
        compareVersions(APP_VERSION, data.min_app_version) < 0
          ? { phones: companyPhones(data) }
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

  // The service worker skips waiting and claims the page (src/app/sw.ts):
  // fetch the new one, wait (up to 10 s) until it takes over, then reload, so
  // the old worker can't answer the reload with the old build.
  const update = async () => {
    setUpdating(true);
    try {
      const container = navigator.serviceWorker;
      const registration = await container?.getRegistration();
      if (container && registration) {
        const takenOver = new Promise<void>((resolve) => {
          container.addEventListener("controllerchange", () => resolve(), { once: true });
          setTimeout(resolve, 10_000);
        });
        await registration.update();
        if (registration.installing || registration.waiting) await takenOver;
      }
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
        phones={required.phones}
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
