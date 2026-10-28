import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { OtpForm } from "@/components/auth/otp-form";
import { Screen } from "@/components/layout/screen";
import { BackButton } from "@/components/ui/back-button";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { RESEND_AFTER_S, secondsUntilResend } from "@/lib/auth/pending-login";
import { readPhoneChange } from "@/lib/auth/phone-change";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";

import { resendPhoneChangeCode, verifyPhoneChangeCode } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("PhoneChange");
  return { title: t("metaTitle") };
}

/** The phone change's code screen (N10): OTP's screen, for whichever number the cookie names. */
export default function ChangePhoneVerifyPage() {
  return (
    <Screen className="gap-5 px-6 pt-5 pb-safe-6">
      <Suspense fallback={<VerifySkeleton />}>
        <VerifyContent />
      </Suspense>
    </Screen>
  );
}

async function VerifyContent() {
  const viewer = await requireViewer(routes.changePhoneVerify);
  const change = await readPhoneChange(viewer.id);
  if (!change?.phone) redirect(routes.changePhone);

  return (
    <>
      <BackButton href={routes.changePhone} />
      <OtpForm
        // A new step or number gets a fresh form (Next keeps visited pages alive).
        key={`${change.step}:${change.phone}`}
        phone={change.phone}
        channel={change.channel}
        smsEnabled={change.smsEnabled}
        waitS={secondsUntilResend(change)}
        resendAfterS={RESEND_AFTER_S}
        // Only the new number can be changed from here; the current one is the account's.
        changeHref={change.step === "new" ? routes.changePhone : undefined}
        verifyAction={verifyPhoneChangeCode}
        resendAction={resendPhoneChangeCode}
      />
    </>
  );
}

function VerifySkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-5">
      <Skeleton className="size-11 rounded-full" />
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-14 w-full rounded-input" />
      <Skeleton className="h-14 w-full rounded-button" />
    </SkeletonGroup>
  );
}
