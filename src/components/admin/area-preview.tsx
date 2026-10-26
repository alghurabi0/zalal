import { areaPath, boundsOf, type MultiPolygonCoords, projector } from "@/lib/admin/geojson";
import { cn } from "@/lib/cn";

const WIDTH = 400;
const HEIGHT = 260;

/**
 * A drawn preview of a service area (A13 without a Google Maps key): the
 * shape to scale, north up, with `context` (the other areas) faint behind
 * it. It is a picture of the outline, not a map.
 */
export function AreaPreview({
  area,
  context = [],
  label,
  className,
}: {
  area: MultiPolygonCoords;
  context?: MultiPolygonCoords[];
  label: string;
  className?: string;
}) {
  const bounds = boundsOf([area, ...context]);
  const project = bounds ? projector(bounds, WIDTH, HEIGHT, 16) : null;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("w-full rounded-chip bg-map-bg", className)}
    >
      {project &&
        context.map((other, i) => (
          <path
            key={i}
            d={areaPath(other, project)}
            fillRule="evenodd"
            className="fill-track/60 stroke-control-off"
            strokeWidth={1}
          />
        ))}
      {project && (
        <path
          d={areaPath(area, project)}
          fillRule="evenodd"
          className="fill-teal/20 stroke-teal"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
