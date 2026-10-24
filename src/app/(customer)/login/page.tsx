import { Suspense } from "react";

import { Screen } from "@/components/layout/screen";
import { BackButton } from "@/components/ui/back-button";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { routes, safeNext } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

/** Login (Login.dc.html, spec §5.2). */
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Screen className="gap-6 px-6 pt-5 pb-safe-8">
      <BackButton href={routes.welcome} />
      <Suspense fallback={<LoginSkeleton />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </Screen>
  );
}

async function LoginContent({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  const supabase = await createClient();
  // Settings are readable by guests; Login hides SMS while it's off.
  const { data, error } = await supabase.from("settings").select("sms_enabled").single();
  if (error) throw new Error(`Settings read failed: ${error.message}`);

  return <LoginForm smsEnabled={data.sms_enabled} next={safeNext(next)} />;
}

function LoginSkeleton() {
  return (
    <SkeletonGroup className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-12 w-full" />
      </div>
      <Skeleton className="h-22 w-full" />
      <Skeleton className="h-20 w-full" />
      <div className="flex-1" />
      <Skeleton className="h-14 w-full rounded-button" />
    </SkeletonGroup>
  );
}
