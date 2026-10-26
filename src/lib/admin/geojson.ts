// Service-area shapes for the A13 editor (spec §8.2). The database stores a
// MultiPolygon and hands it over as GeoJSON (admin_service_areas); the
// editor imports and exports GeoJSON files and draws a preview. GeoJSON
// positions are [longitude, latitude].

/** [lng, lat] */
export type Position = [number, number];
/** A closed ring: the first position repeats as the last. */
export type Ring = Position[];
/** An outer ring, then any holes. */
export type PolygonCoords = Ring[];
export type MultiPolygonCoords = PolygonCoords[];

/** The database refuses more (ZL016). */
export const MAX_AREA_POINTS = 5000;

export type AreaParseError = "json" | "type" | "empty" | "too_many_points";

export type AreaParseResult =
  { ok: true; area: MultiPolygonCoords } | { ok: false; error: AreaParseError };

function isPosition(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** A ring as 2D positions, closed. Null when it isn't one. */
function readRing(value: unknown): Ring | null {
  if (!Array.isArray(value) || !value.every(isPosition)) return null;
  const ring: Ring = value.map((p) => [p[0]!, p[1]!]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1]))
    ring.push([first[0], first[1]]);
  // A triangle is the smallest ring: 3 corners and the closing repeat.
  return ring.length >= 4 ? ring : null;
}

function readPolygon(value: unknown): PolygonCoords | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rings = value.map(readRing);
  return rings.every((r): r is Ring => r !== null) ? rings : null;
}

/** The polygons in a GeoJSON geometry, Feature or FeatureCollection. */
function polygonsOf(value: unknown): MultiPolygonCoords | null {
  if (typeof value !== "object" || value === null) return null;
  const object = value as {
    type?: unknown;
    coordinates?: unknown;
    geometry?: unknown;
    features?: unknown;
  };
  switch (object.type) {
    case "Polygon": {
      const polygon = readPolygon(object.coordinates);
      return polygon ? [polygon] : null;
    }
    case "MultiPolygon": {
      if (!Array.isArray(object.coordinates)) return null;
      const polygons = object.coordinates.map(readPolygon);
      return polygons.every((p): p is PolygonCoords => p !== null) ? polygons : null;
    }
    case "Feature":
      return polygonsOf(object.geometry);
    case "FeatureCollection": {
      if (!Array.isArray(object.features)) return null;
      const parts = object.features.map(polygonsOf);
      return parts.every((p): p is MultiPolygonCoords => p !== null) ? parts.flat() : null;
    }
    default:
      return null;
  }
}

export function pointCount(area: MultiPolygonCoords): number {
  return area.reduce((sum, polygon) => sum + polygon.reduce((s, ring) => s + ring.length, 0), 0);
}

/**
 * Reads an imported file or pasted text: a Polygon or MultiPolygon, or a
 * Feature or FeatureCollection of them (their polygons become the parts of
 * one area). Rings are closed if the file left them open. The database
 * checks the shape again (valid, inside Iraq).
 */
export function parseAreaGeoJson(text: string): AreaParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "json" };
  }
  const area = polygonsOf(value);
  if (area === null) return { ok: false, error: "type" };
  if (area.length === 0) return { ok: false, error: "empty" };
  if (pointCount(area) > MAX_AREA_POINTS) return { ok: false, error: "too_many_points" };
  return { ok: true, area };
}

/** The shape from admin_service_areas (a GeoJSON MultiPolygon). */
export function areaFromDatabase(value: unknown): MultiPolygonCoords {
  return polygonsOf(value) ?? [];
}

export function toGeometry(area: MultiPolygonCoords) {
  return { type: "MultiPolygon" as const, coordinates: area };
}

/** The file "تنزيل GeoJSON" saves: one Feature named after the area. */
export function toFeatureCollection(name: string, area: MultiPolygonCoords): string {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { name }, geometry: toGeometry(area) }],
    },
    null,
    2,
  );
}

/** A file name for the export: the area id, no Arabic (some systems mangle it). */
export function exportFileName(id: number | null): string {
  return id === null ? "service-area.geojson" : `service-area-${id}.geojson`;
}

export type Bounds = { minLng: number; minLat: number; maxLng: number; maxLat: number };

export function boundsOf(areas: MultiPolygonCoords[]): Bounds | null {
  let bounds: Bounds | null = null;
  for (const area of areas)
    for (const polygon of area)
      for (const ring of polygon)
        for (const [lng, lat] of ring) {
          bounds = bounds
            ? {
                minLng: Math.min(bounds.minLng, lng),
                minLat: Math.min(bounds.minLat, lat),
                maxLng: Math.max(bounds.maxLng, lng),
                maxLat: Math.max(bounds.maxLat, lat),
              }
            : { minLng: lng, minLat: lat, maxLng: lng, maxLat: lat };
        }
  return bounds;
}

/**
 * A projection of `bounds` into a `width` × `height` box with `pad` on each
 * side, keeping the shape: a degree of longitude is cos(latitude) as wide as
 * a degree of latitude (equirectangular, fine at city scale). North is up
 * and east is right, as on any map, whatever the page direction.
 */
export function projector(bounds: Bounds, width: number, height: number, pad: number) {
  const midLat = ((bounds.minLat + bounds.maxLat) / 2) * (Math.PI / 180);
  const xScale = Math.cos(midLat);
  const spanX = Math.max((bounds.maxLng - bounds.minLng) * xScale, 1e-9);
  const spanY = Math.max(bounds.maxLat - bounds.minLat, 1e-9);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return ([lng, lat]: Position): [number, number] => [
    offsetX + (lng - bounds.minLng) * xScale * scale,
    offsetY + (bounds.maxLat - lat) * scale,
  ];
}

/** An SVG path for the area (fill-rule evenodd shows holes as holes). */
export function areaPath(area: MultiPolygonCoords, project: (p: Position) => [number, number]) {
  return area
    .flatMap((polygon) =>
      polygon.map(
        (ring) =>
          ring
            .map((p, i) => {
              const [x, y] = project(p);
              return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(" ") + " Z",
      ),
    )
    .join(" ");
}
