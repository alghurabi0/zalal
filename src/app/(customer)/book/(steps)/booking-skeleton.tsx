import { Screen } from "@/components/layout/screen";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";

/** Loading state for the booking steps, shaped like step 1. */
export function BookingSkeleton() {
  return (
    <Screen className="bg-bg">
      <SkeletonGroup className="flex flex-1 flex-col gap-3.5 px-5 pt-4.5">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <Skeleton className="h-1.25 w-full" />
        <Skeleton className="h-15 w-full rounded-input" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-28 w-full rounded-button" />
        <Skeleton className="h-5 w-24" />
        <div className="flex gap-2">
          <Skeleton className="h-15 w-20 rounded-chip" />
          <Skeleton className="h-15 w-20 rounded-chip" />
          <Skeleton className="h-15 w-20 rounded-chip" />
          <Skeleton className="h-15 w-20 rounded-chip" />
        </div>
        <Skeleton className="h-11.5 w-full rounded-chip" />
      </SkeletonGroup>
    </Screen>
  );
}
