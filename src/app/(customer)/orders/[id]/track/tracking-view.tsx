"use client";

import { MessageSquare, Phone, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { TrackingMap } from "@/components/live/tracking-map";
import { useCrewPosition } from "@/components/live/use-crew-position";
import { useServerNow } from "@/components/live/use-server-now";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SheetPanel } from "@/components/ui/sheet-panel";
import { cn } from "@/lib/cn";
import type { TrackingData } from "@/lib/live/queries";
import { ageSeconds, distanceKm, distanceParts, isStale, trackingSteps } from "@/lib/live/tracking";
import { routes } from "@/lib/routes";

/**
 * The live part of Tracking (spec §5.13). The crew's position comes from
 * Realtime; its age is counted against the server's clock (`readAt`), so
 * a phone set to the wrong time still shows the right age. The age appears
 * after hydration, since the server can't know the phone's clock.
 */
export function TrackingView({ order }: { order: TrackingData }) {
  const t = useTranslations("Tracking");
  const onTheWay = order.status === "on_the_way";
  const position = useCrewPosition(order.id, order.crewId, order.position, onTheWay);
  const now = useServerNow(order.readAt, 1000, onTheWay);

  const age = position && now !== null ? ageSeconds(position.updated_at, now) : null;
  const stale = age !== null && isStale(age);
  const distance = position ? distanceParts(distanceKm(order.home, position)) : null;

  return (
    <div className="flex h-full flex-col">
      <h1 className="sr-only">{t("title")}</h1>
      <div className="relative min-h-50 flex-1" role="img" aria-label={t("map")}>
        <TrackingMap home={order.home} crew={position} stale={stale} />
        <div className="absolute inset-x-5 top-5 z-10 flex items-center justify-between">
          <BackButton href={routes.order(order.id)} variant="floating" />
          {onTheWay && (
            <span className="flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-13 font-extrabold text-navy shadow-float">
              <span aria-hidden className="size-2 rounded-full bg-ok" />
              {t("live")}
            </span>
          )}
        </div>
      </div>

      <SheetPanel className="relative z-10 -mt-6 gap-3.5 pt-3">
        <div className="flex items-end justify-between gap-3" aria-live="polite">
          {!onTheWay ? (
            <div className="flex flex-col">
              <span className="text-13 text-muted">{t("arrivedBody")}</span>
              <span className="text-26 font-black">{t("arrivedLabel")}</span>
            </div>
          ) : distance ? (
            <>
              <div className="flex flex-col">
                <span className="text-13 text-muted">{t("distanceLabel")}</span>
                <span className="text-26 font-black" data-testid="distance">
                  {t(distance.unit, { value: distance.value })}
                </span>
              </div>
              {age !== null && (
                <span className="text-13 text-muted" data-testid="updated">
                  {age < 5
                    ? t("updatedNow")
                    : age < 60
                      ? t("updatedSeconds", { count: age })
                      : t("updatedMinutes", { count: Math.floor(age / 60) })}
                </span>
              )}
            </>
          ) : (
            <div className="flex flex-col">
              <span className="text-20 font-black">{t("waiting")}</span>
              <span className="text-13 text-muted">{t("waitingBody")}</span>
            </div>
          )}
        </div>
        {onTheWay && stale && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-chip bg-warn-bg px-3 py-2 text-13 font-bold text-warn-strong"
          >
            <TriangleAlert aria-hidden className="size-4 shrink-0 text-warn-icon" />
            {t("stale")}
          </p>
        )}

        <ol aria-label={t("steps.label")} className="grid grid-cols-4 gap-1">
          {trackingSteps(order.status).map(({ step, state }) => (
            <li key={step} className="flex flex-col gap-1.5" data-state={state}>
              <span
                aria-hidden
                className={cn(
                  "h-1.5 rounded-full",
                  state === "done" ? "bg-navy" : state === "now" ? "bg-aqua" : "bg-border",
                )}
              />
              <span
                className={cn(
                  "text-center text-12",
                  state === "next" ? "font-semibold text-muted" : "font-extrabold text-navy",
                )}
              >
                {t(`steps.${step}`)}
                <span className="sr-only"> ({t(`stepState.${state}`)})</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="flex items-center gap-3 rounded-card bg-bg p-3">
          <div className="flex flex-1 flex-col">
            <span className="text-15 font-extrabold">{t("contact")}</span>
            <span className="text-12 text-muted">
              {order.companyPhone ? t("contactBody") : t("contactChat")}
            </span>
          </div>
          {order.companyPhone && (
            <IconButton
              href={`tel:${order.companyPhone}`}
              label={t("call")}
              icon={Phone}
              className="border border-border bg-surface"
            />
          )}
          <IconButton
            href={routes.chatAbout(order.id)}
            label={t("chat")}
            icon={MessageSquare}
            className="border border-border bg-surface"
          />
        </div>

        {onTheWay ? (
          <Button size="footer" disabled className="w-full">
            {t("followLater")}
          </Button>
        ) : (
          <Button href={routes.jobProgress(order.id)} size="footer" className="w-full">
            {t("follow")}
          </Button>
        )}
      </SheetPanel>
    </div>
  );
}
