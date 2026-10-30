import { useTranslations } from "next-intl";

import { LogoTile } from "@/components/brand/logo-tile";
import { WelcomeWaves } from "@/components/illustrations/welcome-waves";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/**
 * Welcome (Main.dc.html, spec §5.1). proxy.ts shows it on first open only
 * and sends a logged-in user straight to Home.
 */
export default function WelcomePage() {
  const t = useTranslations("Welcome");

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-phone flex-col overflow-hidden bg-navy text-white">
      <WelcomeWaves className="absolute inset-x-0 bottom-0" />
      <div className="relative flex flex-1 flex-col items-center justify-center gap-5.5 px-8">
        <LogoTile />
        <h1 className="text-44 leading-display font-black">{t("name")}</h1>
        <p className="text-center text-17 text-on-dark-body">{t("tagline")}</p>
      </div>
      <div className="relative flex flex-col gap-3 px-6 pb-safe-10">
        <Button href={routes.login} variant="accent">
          {t("start")}
        </Button>
        <Button href={routes.home} variant="ghost" size="card" className="rounded-button text-15">
          {t("browse")}
        </Button>
      </div>
    </main>
  );
}
