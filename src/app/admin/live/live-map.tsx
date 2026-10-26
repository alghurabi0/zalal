"use client";

// TypeScript 6 no longer loads every @types package by itself.
/// <reference types="google.maps" />

import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  APIProvider,
  Map,
} from "@vis.gl/react-google-maps";
import { MapPinned } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { CrewPin, HomePin } from "@/components/live/pins";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { areaPath, boundsOf, type MultiPolygonCoords, projector } from "@/lib/admin/geojson";
import type { LiveJob, LiveMapData } from "@/lib/admin/live-queries";
import { cn } from "@/lib/cn";
import { publicEnv } from "@/lib/env";
import type { CrewPosition } from "@/lib/live/queries";
import { ageSeconds, distanceKm, distanceParts, isStale } from "@/lib/live/tracking";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/browser";

const WIDTH = 800;
const HEIGHT = 460;

type PositionRow = CrewPosition & { order_id: string; crew_id: string };

/** The live map and list (A3). Positions are newer of the page's and Realtime's. */
export function LiveMap({ data }: { data: LiveMapData }) {
  const t = useTranslations("Admin.liveMap");
  const live = useLivePositions();
  const now = useServerNow(data.readAt);

  const jobs = data.jobs.map((job) => {
    const update = live.get(job.orderId);
    const position =
      update &&
      update.crew_id === job.crewId &&
      (!job.position || Date.parse(update.updated_at) > Date.parse(job.position.updated_at))
        ? update
        : job.position;
    const age = position && now !== null ? ageSeconds(position.updated_at, now, 0) : null;
    return { ...job, position, age, stale: age !== null && isStale(age) };
  });

  if (jobs.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState icon={MapPinned} title={t("emptyTitle")} description={t("emptyBody")} />
      </Card>
    );
  }

  const { NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: apiKey, NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID: mapId } =
    publicEnv();
  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        {apiKey && mapId ? (
          <GoogleLiveMap apiKey={apiKey} mapId={mapId} jobs={jobs} />
        ) : (
          <DrawnLiveMap areas={data.areas} jobs={jobs} label={t("map")} />
        )}
        <div className="flex gap-4 border-t border-divider px-4 py-2.5 text-13 text-muted">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-full bg-navy" />
            {t("legendCrew")}
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-full border-2 border-navy bg-aqua" />
            {t("legendHome")}
          </span>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-start text-14">
          <caption className="sr-only">{t("list")}</caption>
          <thead className="text-13 text-muted">
            <tr className="border-b border-divider">
              {(["crew", "order", "place", "updated", "distance"] as const).map((column) => (
                <th key={column} scope="col" className="px-4 py-3 text-start font-bold">
                  {t(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const distance = job.position
                ? distanceParts(distanceKm(job.home, job.position))
                : null;
              return (
                <tr key={job.orderId} className="border-b border-divider last:border-0">
                  <td className="px-4 py-3 font-extrabold">{job.crewName}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={routes.adminOrder(job.orderId)}
                      className="inline-flex min-h-11 items-center font-extrabold text-teal"
                    >
                      <span dir="ltr">#{job.number}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {job.district}
                    <span className="block text-13 text-muted">{job.landmark}</span>
                  </td>
                  <td className="px-4 py-3" data-testid="age">
                    {!job.position ? (
                      <span className="text-muted">{t("noPosition")}</span>
                    ) : job.age === null ? null : (
                      <span className={cn(job.stale && "font-bold text-warn-fg")}>
                        {job.age < 5
                          ? t("now")
                          : job.age < 60
                            ? t("seconds", { count: job.age })
                            : t("minutes", { count: Math.floor(job.age / 60) })}
                        {job.stale && ` · ${t("stale")}`}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3" data-testid="distance">
                    {distance ? t(distance.unit, { value: distance.value }) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

type ShownJob = LiveJob & { stale: boolean };

/** Without a Google key: the service areas to scale, the homes and the crews. */
function DrawnLiveMap({
  areas,
  jobs,
  label,
}: {
  areas: MultiPolygonCoords[];
  jobs: ShownJob[];
  label: string;
}) {
  // Fitted to the homes and crews (at least about 2 km across), not the
  // whole service area, so nearby crews don't sit on top of each other.
  const points = jobs.flatMap((job) => [job.home, ...(job.position ? [job.position] : [])]);
  const bounds = points.length > 0 ? fitPoints(points, 0.01) : boundsOf(areas);
  const project = bounds ? projector(bounds, WIDTH, HEIGHT, 32) : null;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full overflow-hidden bg-map-bg"
      data-testid="drawn-live-map"
    >
      {project && (
        <>
          {areas.map((area, i) => (
            <path
              key={i}
              d={areaPath(area, project)}
              fillRule="evenodd"
              className="fill-teal/10 stroke-teal/60"
              strokeWidth={1.5}
            />
          ))}
          {jobs.map((job) => {
            const [hx, hy] = project([job.home.lng, job.home.lat]);
            const crew = job.position ? project([job.position.lng, job.position.lat]) : null;
            return (
              <g key={job.orderId} data-testid="live-job">
                {crew && (
                  <line
                    x1={hx}
                    y1={hy}
                    x2={crew[0]}
                    y2={crew[1]}
                    className="stroke-navy/40"
                    strokeWidth={2}
                    strokeDasharray="4 6"
                  />
                )}
                <circle cx={hx} cy={hy} r={7} className="fill-aqua stroke-navy" strokeWidth={2.5} />
                {crew && (
                  <g className={cn(job.stale && "opacity-50")}>
                    <circle
                      cx={crew[0]}
                      cy={crew[1]}
                      r={11}
                      className="fill-navy stroke-white"
                      strokeWidth={3}
                    />
                    <text
                      x={crew[0]}
                      y={crew[1] - 18}
                      textAnchor="middle"
                      className="fill-navy text-13 font-extrabold"
                    >
                      {`#${job.number}`}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </>
      )}
    </svg>
  );
}

/** The points' bounds, widened to at least `minHalf` degrees each way from the middle. */
function fitPoints(points: { lat: number; lng: number }[], minHalf: number) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const halfLat = Math.max((Math.max(...lats) - Math.min(...lats)) / 2, minHalf);
  const halfLng = Math.max((Math.max(...lngs) - Math.min(...lngs)) / 2, minHalf);
  return {
    minLat: midLat - halfLat,
    maxLat: midLat + halfLat,
    minLng: midLng - halfLng,
    maxLng: midLng + halfLng,
  };
}

function GoogleLiveMap({
  apiKey,
  mapId,
  jobs,
}: {
  apiKey: string;
  mapId: string;
  jobs: ShownJob[];
}) {
  const points = jobs.flatMap((job) => [job.home, ...(job.position ? [job.position] : [])]);
  const bounds = {
    north: Math.max(...points.map((p) => p.lat)),
    south: Math.min(...points.map((p) => p.lat)),
    east: Math.max(...points.map((p) => p.lng)),
    west: Math.min(...points.map((p) => p.lng)),
    padding: 48,
  };
  return (
    <div className="relative h-115">
      <APIProvider apiKey={apiKey} language="ar" region="IQ">
        <Map
          className="absolute inset-0"
          mapId={mapId}
          defaultBounds={bounds}
          gestureHandling="greedy"
          clickableIcons={false}
        >
          {jobs.map((job) => (
            <AdvancedMarker
              key={`home:${job.orderId}`}
              position={job.home}
              anchorPoint={AdvancedMarkerAnchorPoint.BOTTOM_CENTER}
            >
              <HomePin className="scale-75" />
            </AdvancedMarker>
          ))}
          {jobs.map((job) =>
            job.position ? (
              <AdvancedMarker
                key={`crew:${job.orderId}`}
                position={job.position}
                anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
                title={`#${job.number} · ${job.crewName}`}
              >
                <CrewPin stale={job.stale} />
              </AdvancedMarker>
            ) : null,
          )}
        </Map>
      </APIProvider>
    </div>
  );
}

/**
 * Every position update admins may read, from Realtime (the policy lets
 * admins read all). Inserts and updates only: DELETE events skip RLS.
 */
function useLivePositions(): ReadonlyMap<string, PositionRow> {
  const [positions, setPositions] = useState<ReadonlyMap<string, PositionRow>>(
    () => new globalThis.Map(),
  );

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let closed = false;
    const take = (row: Partial<PositionRow>) => {
      if (!row.order_id || !row.crew_id || !row.updated_at) return;
      const next = row as PositionRow;
      setPositions((current) => {
        const seen = current.get(next.order_id);
        if (seen && Date.parse(seen.updated_at) >= Date.parse(next.updated_at)) return current;
        const copy = new globalThis.Map(current);
        copy.set(next.order_id, next);
        return copy;
      });
    };

    void (async () => {
      // Join with the admin's token, or RLS sends nothing (spec §3).
      const { data } = await supabase.auth.getSession();
      if (closed || !data.session) return;
      await supabase.realtime.setAuth(data.session.access_token);
      if (closed) return;
      const table = { schema: "public", table: "crew_live_location" };
      channel = supabase
        .channel(`admin-live-map:${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "INSERT", ...table }, (payload) => take(payload.new))
        .on("postgres_changes", { event: "UPDATE", ...table }, (payload) => take(payload.new))
        .subscribe();
    })();

    return () => {
      closed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  return positions;
}

/** The server's clock, every 5 s (see Tracking). Null until mounted. */
function useServerNow(readAt: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const offset = readAt - Date.now();
    const tick = () => setNow(Date.now() + offset);
    tick();
    const timer = window.setInterval(tick, 5000);
    return () => window.clearInterval(timer);
  }, [readAt]);
  return now;
}
