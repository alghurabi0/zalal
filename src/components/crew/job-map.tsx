"use client";

import { APIProvider, Map } from "@vis.gl/react-google-maps";

import { MapPlaceholder } from "@/components/illustrations/map-placeholder";
import { CenterPin } from "@/components/location/center-pin";
import { publicEnv } from "@/lib/env";

/**
 * C3's map: the customer's pin. A Google map when the key is set; without
 * one (local, CI) the drawn map, as on Location (spec §5.4). Directions open
 * in Google Maps from the link under it.
 */
export function JobMap({ lat, lng }: { lat: number; lng: number }) {
  const apiKey = publicEnv().NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  return (
    <div className="relative h-44 overflow-hidden rounded-t-card bg-well">
      {apiKey ? (
        <APIProvider apiKey={apiKey} language="ar" region="IQ">
          <Map
            className="absolute inset-0"
            defaultCenter={{ lat, lng }}
            defaultZoom={16}
            gestureHandling="cooperative"
            disableDefaultUI
            clickableIcons={false}
          />
        </APIProvider>
      ) : (
        <MapPlaceholder className="absolute inset-0" />
      )}
      <CenterPin />
    </div>
  );
}
