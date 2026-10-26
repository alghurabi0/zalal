"use client";

// TypeScript 6 no longer loads every @types package by itself.
/// <reference types="google.maps" />

import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  APIProvider,
  Map,
} from "@vis.gl/react-google-maps";

import { MapPlaceholder } from "@/components/illustrations/map-placeholder";
import { publicEnv } from "@/lib/env";
import { type LatLng, placePins } from "@/lib/live/tracking";

import { CrewPin, HomePin } from "./pins";

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;

/**
 * Tracking's map (spec §5.13): the home pin and the crew's latest position.
 * With a Google Maps key and Map ID, a Google map; without them (local, CI)
 * the drawn map with both pins placed to scale and a straight dashed line,
 * since v1 has no routing (§1).
 */
export function TrackingMap({
  home,
  crew,
  stale,
}: {
  home: LatLng;
  crew: LatLng | null;
  stale: boolean;
}) {
  const { NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: apiKey, NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID: mapId } =
    publicEnv();
  if (apiKey && mapId) {
    return (
      <GoogleTrackingMap apiKey={apiKey} mapId={mapId} home={home} crew={crew} stale={stale} />
    );
  }
  return <DrawnTrackingMap home={home} crew={crew} stale={stale} />;
}

function DrawnTrackingMap({
  home,
  crew,
  stale,
}: {
  home: LatLng;
  crew: LatLng | null;
  stale: boolean;
}) {
  const pins = placePins(home, crew);
  return (
    <div className="absolute inset-0 overflow-hidden" data-testid="drawn-map">
      <MapPlaceholder className="absolute inset-0" />
      {pins.crew && (
        // Physical coordinates: x runs west to east whatever the page direction.
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
        >
          <line
            x1={pins.home.x * 100}
            y1={pins.home.y * 100}
            x2={pins.crew.x * 100}
            y2={pins.crew.y * 100}
            className="stroke-aqua"
            strokeWidth={4}
            strokeDasharray="2 10"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      {/* In RTL inline-start is the east (right) edge, so x is measured from it.
          The home pin's tip sits on the point. */}
      <span
        className="absolute -translate-y-full ltr:-translate-x-1/2 rtl:translate-x-1/2"
        style={{ insetInlineStart: pct(1 - pins.home.x), top: pct(pins.home.y) }}
      >
        <HomePin />
      </span>
      {pins.crew && (
        <span
          data-testid="crew-pin"
          className="absolute -translate-y-1/2 transition-all duration-700 ltr:-translate-x-1/2 rtl:translate-x-1/2"
          style={{ insetInlineStart: pct(1 - pins.crew.x), top: pct(pins.crew.y) }}
        >
          <CrewPin stale={stale} />
        </span>
      )}
    </div>
  );
}

function GoogleTrackingMap({
  apiKey,
  mapId,
  home,
  crew,
  stale,
}: {
  apiKey: string;
  mapId: string;
  home: LatLng;
  crew: LatLng | null;
  stale: boolean;
}) {
  const bounds = crew
    ? {
        north: Math.max(home.lat, crew.lat),
        south: Math.min(home.lat, crew.lat),
        east: Math.max(home.lng, crew.lng),
        west: Math.min(home.lng, crew.lng),
        padding: 64,
      }
    : undefined;
  return (
    <div className="absolute inset-0">
      <MapPlaceholder className="absolute inset-0" />
      <APIProvider apiKey={apiKey} language="ar" region="IQ">
        <Map
          className="absolute inset-0"
          mapId={mapId}
          // Fitted once; after that only the crew marker moves, so the
          // customer can pan without the map jumping back.
          defaultBounds={bounds}
          defaultCenter={bounds ? undefined : home}
          defaultZoom={bounds ? undefined : 15}
          gestureHandling="greedy"
          disableDefaultUI
          clickableIcons={false}
        >
          <AdvancedMarker position={home} anchorPoint={AdvancedMarkerAnchorPoint.BOTTOM_CENTER}>
            <HomePin />
          </AdvancedMarker>
          {crew && (
            <AdvancedMarker position={crew} anchorPoint={AdvancedMarkerAnchorPoint.CENTER}>
              <CrewPin stale={stale} />
            </AdvancedMarker>
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
