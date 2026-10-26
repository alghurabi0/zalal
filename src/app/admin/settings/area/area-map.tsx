// TypeScript 6 no longer loads every @types package by itself.
/// <reference types="google.maps" />
"use client";

import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { MultiPolygonCoords, PolygonCoords, Ring } from "@/lib/admin/geojson";
import { KARBALA_CENTER } from "@/lib/schemas/address";

// The A13 area editor on Google Maps (spec §8.2), shown only with a key.
// Google's Drawing library is deprecated, so the parts are editable
// google.maps.Polygon objects: drag a corner or a midpoint to change the
// outline, draw a new part by clicking its corners, remove the selected
// part. Every change reports the whole area back as GeoJSON coordinates.

function toPaths(polygon: PolygonCoords): google.maps.LatLngLiteral[][] {
  // Google closes rings itself: drop the repeated last position.
  return polygon.map((ring) => ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng })));
}

/** The part's rings, closed. A ring dragged down to two corners is no ring: a hole is dropped, an outline drops the whole part (empty). */
function fromPolygon(polygon: google.maps.Polygon): PolygonCoords {
  const rings = polygon
    .getPaths()
    .getArray()
    .map((path) => {
      const ring: Ring = path.getArray().map((p) => [p.lng(), p.lat()]);
      const first = ring[0];
      if (first) ring.push([first[0], first[1]]);
      return ring;
    });
  if ((rings[0]?.length ?? 0) < 4) return [];
  return rings.filter((ring) => ring.length >= 4);
}

/** Every part still drawn, without the ones reduced to nothing. */
function partsOf(polygons: google.maps.Polygon[]): MultiPolygonCoords {
  return polygons.map(fromPolygon).filter((part) => part.length > 0);
}

export function AreaMap({
  apiKey,
  area,
  version,
  onChange,
}: {
  apiKey: string;
  area: MultiPolygonCoords;
  /** Bumped when the area is replaced from outside (import, another area); redraws it. */
  version: number;
  onChange: (area: MultiPolygonCoords) => void;
}) {
  return (
    <APIProvider apiKey={apiKey} language="ar" region="IQ">
      <div className="relative h-120 overflow-hidden rounded-chip bg-map-bg">
        <Map
          className="absolute inset-0"
          defaultCenter={KARBALA_CENTER}
          defaultZoom={10}
          gestureHandling="greedy"
          clickableIcons={false}
          streetViewControl={false}
          mapTypeControl={false}
        />
      </div>
      {/* Keyed by version: an area replaced from outside is drawn afresh. */}
      <Parts key={version} area={area} onChange={onChange} />
    </APIProvider>
  );
}

function Parts({
  area,
  onChange,
}: {
  area: MultiPolygonCoords;
  onChange: (area: MultiPolygonCoords) => void;
}) {
  const t = useTranslations("Admin.area");
  const map = useMap();
  const polygons = useRef<google.maps.Polygon[]>([]);
  const fitted = useRef(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [drawing, setDrawing] = useState(false);
  // Bumped when a part is added or removed here, so the parts are drawn again.
  const [layout, setLayout] = useState(0);
  const draft = useRef<google.maps.Polyline | null>(null);
  // The latest values, for listeners made once per drawing.
  const areaRef = useRef(area);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    areaRef.current = area;
    onChangeRef.current = onChange;
  });

  const current = () => partsOf(polygons.current);

  useEffect(() => {
    if (!map) return;
    const listeners: google.maps.MapsEventListener[] = [];
    const bounds = new google.maps.LatLngBounds();
    const drawn = areaRef.current.map((part, index) => {
      const polygon = new google.maps.Polygon({
        map,
        paths: toPaths(part),
        editable: true,
        strokeWeight: 2,
        fillOpacity: 0.15,
      });
      for (const path of polygon.getPaths().getArray()) {
        for (const event of ["set_at", "insert_at", "remove_at"]) {
          listeners.push(path.addListener(event, () => onChangeRef.current(current())));
        }
        for (const p of path.getArray()) bounds.extend(p);
      }
      listeners.push(polygon.addListener("click", () => setSelected(index)));
      return polygon;
    });
    polygons.current = drawn;
    if (!fitted.current && !bounds.isEmpty()) {
      map.fitBounds(bounds, 24);
      fitted.current = true;
    }
    return () => {
      for (const listener of listeners) listener.remove();
      for (const polygon of drawn) polygon.setMap(null);
    };
  }, [map, layout]);

  // The selected part is drawn thicker.
  useEffect(() => {
    polygons.current.forEach((polygon, index) =>
      polygon.setOptions({ strokeWeight: index === selected ? 4 : 2 }),
    );
  }, [selected, layout]);

  // Drawing a new part: each map click adds a corner.
  useEffect(() => {
    if (!map || !drawing) return;
    const line = new google.maps.Polyline({ map, clickable: false, strokeWeight: 2 });
    draft.current = line;
    const listener = map.addListener("click", (event: google.maps.MapMouseEvent) => {
      if (event.latLng) line.getPath().push(event.latLng);
    });
    return () => {
      listener.remove();
      line.setMap(null);
      draft.current = null;
    };
  }, [map, drawing]);

  const replaceParts = (next: MultiPolygonCoords) => {
    // The new parts reach areaRef before the redraw effect runs.
    areaRef.current = next;
    onChangeRef.current(next);
    setSelected(null);
    setLayout((n) => n + 1);
  };

  const finishPart = () => {
    const points = draft.current?.getPath().getArray() ?? [];
    setDrawing(false);
    if (points.length < 3) return;
    const ring: Ring = points.map((p) => [p.lng(), p.lat()]);
    const first = ring[0];
    if (first) ring.push([first[0], first[1]]);
    replaceParts([...current(), [ring]]);
  };

  const removePart = () => {
    if (selected === null) return;
    replaceParts(current().filter((_, i) => i !== selected));
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-13 text-muted">{t("mapHint")}</p>
      <div className="flex flex-wrap gap-2">
        {drawing ? (
          <>
            <Button size="sm" onClick={finishPart}>
              {t("finishPart")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDrawing(false)}>
              {t("cancelDraw")}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={() => setDrawing(true)}>
              {t("drawPart")}
            </Button>
            <Button size="sm" variant="secondary" disabled={selected === null} onClick={removePart}>
              {t("removePart")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
