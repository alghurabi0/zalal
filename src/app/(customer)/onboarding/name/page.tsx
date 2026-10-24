import { Suspense } from "react";

import { Screen } from "@/components/layout/screen";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/auth/viewer";
import { routes, safeNext, withNext } from "@/lib/routes";

import { NameForm } from "./name-form";

/** Name (N1, spec §5 "New screens"): right after a new user's first login. */
export default function NamePage({ searchParams }: PageProps<"/onboarding/name">) {
  return (
    <Screen className="gap-6 px-6 pt-16 pb-safe-8">
      <Suspense fallback={<NameSkeleton />}>
        <NameContent searchParams={searchParams} />
      </Suspense>
    </Screen>
  );
}

async function NameContent({ searchParams }: Pick<PageProps<"/onboarding/name">, "searchParams">) {
  const next = safeNext((await searchParams).next);
  const viewer = await requireViewer(withNext(routes.name, next));
  return <NameForm defaultName={viewer.fullName ?? ""} next={next} />;
}

function NameSkeleton() {
  return (
    <SkeletonGroup className="flex flex-1 flex-col gap-6">
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-22 w-full" />
      <div className="flex-1" />
      <Skeleton className="h-14 w-full rounded-button" />
    </SkeletonGroup>
  );
}
