import { redirect } from "next/navigation";
import { Suspense } from "react";

import { OtpForm } from "@/components/auth/otp-form";
import { Screen } from "@/components/layout/screen";
import { BackButton } from "@/components/ui/back-button";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { readPendingLogin, RESEND_AFTER_S, secondsUntilResend } from "@/lib/auth/pending-login";
import { routes, withNext } from "@/lib/routes";

import { resendCode, verifyCode } from "../actions";

/** OTP (Otp.dc.html, spec §5.3). The number comes from the pending-login cookie. */
export default function VerifyPage() {
  return (
    <Screen className="gap-5 px-6 pt-5 pb-safe-6">
      <Suspense fallback={<VerifySkeleton />}>
        <VerifyContent />
      </Suspense>
    </Screen>
  );
}

async function VerifyContent() {
  const pending = await readPendingLogin();
  if (!pending) redirect(routes.login);
  const loginHref = withNext(routes.login, pending.next);

  return (
    <>
      <BackButton href={loginHref} />
      <OtpForm
        // Next keeps recently visited pages alive: another number gets a
        // fresh form. Not keyed by the send time, so a resend keeps the form
        // (and its "sent a new code" message); logout reloads the page.
        key={pending.phone}
        phone={pending.phone}
        channel={pending.channel}
        smsEnabled={pending.smsEnabled}
        waitS={secondsUntilResend(pending)}
        resendAfterS={RESEND_AFTER_S}
        changeHref={loginHref}
        verifyAction={verifyCode}
        resendAction={resendCode}
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
