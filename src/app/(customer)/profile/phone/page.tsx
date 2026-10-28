import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Screen } from "@/components/layout/screen";
import { BackButton } from "@/components/ui/back-button";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { readPhoneChange } from "@/lib/auth/phone-change";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

import { CurrentPhoneForm, NewPhoneForm } from "./phone-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("PhoneChange");
  return { title: t("metaTitle") };
}

/**
 * Phone change (N10, spec §9.1): step 1 sends a code to the current number;
 * once it is proved (the signed cookie says so), step 2 asks for the new
 * number and sends it a code. Both codes are typed on the shared OTP screen.
 */
export default function ChangePhonePage() {
  return (
    <Screen className="gap-6 px-6 pt-5 pb-safe-8">
      <BackButton href={routes.editProfile} />
      <Suspense fallback={<PhoneSkeleton />}>
        <PhoneContent />
      </Suspense>
    </Screen>
  );
}

async function PhoneContent() {
  const viewer = await requireViewer(routes.changePhone);
  const change = await readPhoneChange(viewer.id);
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("sms_enabled").single();
  if (error) throw new Error(`Settings read failed: ${error.message}`);

  if (change?.step === "new") return <NewPhoneForm smsEnabled={data.sms_enabled} />;
  return <CurrentPhoneForm phone={viewer.phone} smsEnabled={data.sms_enabled} />;
}

function PhoneSkeleton() {
  return (
    <SkeletonGroup className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-12 w-full" />
      </div>
      <Skeleton className="h-20 w-full" />
      <div className="flex-1" />
      <Skeleton className="h-14 w-full rounded-button" />
    </SkeletonGroup>
  );
}
