import { MapPlaceholder } from "@/components/illustrations/map-placeholder";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";

/** Location while it loads: the drawn map and the sheet's outline. */
export function LocationSkeleton() {
  return (
    <SkeletonGroup className="mx-auto flex h-dvh w-full max-w-phone flex-col overflow-hidden bg-map-bg">
      <div className="relative flex-1">
        <MapPlaceholder className="absolute inset-0" />
      </div>
      <div className="relative -mt-6 flex flex-col gap-3 rounded-t-sheet bg-surface px-5 pt-8 pb-safe-6 shadow-sheet">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-5 w-60" />
        <Skeleton className="h-11.5 w-full" />
        <Skeleton className="h-11.5 w-full" />
        <Skeleton className="h-10 w-64 rounded-full" />
        <Skeleton className="h-14 w-full rounded-button" />
      </div>
    </SkeletonGroup>
  );
}
