import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Screen } from "@/components/layout/screen";
import { BackButton } from "@/components/ui/back-button";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/auth/viewer";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";

import { EditNameForm } from "./edit-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("EditProfile");
  return { title: t("metaTitle") };
}

/**
 * Edit profile (N10, spec §5.8, decision 12): the name (N1's rules) and the
 * phone, which changes only through two codes ("تغيير الرقم"). No tab bar.
 */
export default async function EditProfilePage({ searchParams }: PageProps<"/profile/edit">) {
  const t = await getTranslations("EditProfile");
  return (
    <Screen className="gap-6 px-6 pt-5 pb-safe-8">
      <div className="flex items-center gap-3">
        <BackButton href={routes.profile} />
        <h1 className="text-22 font-black">{t("title")}</h1>
      </div>
      <Suspense fallback={<EditSkeleton />}>
        <EditContent searchParams={searchParams} />
      </Suspense>
    </Screen>
  );
}

async function EditContent({ searchParams }: Pick<PageProps<"/profile/edit">, "searchParams">) {
  const t = await getTranslations("EditProfile");
  const viewer = await requireViewer(routes.editProfile);
  const { phone: phoneParam } = await searchParams;

  return (
    <EditNameForm
      // A changed name or phone gets a fresh form (Next keeps visited pages alive).
      key={`${viewer.fullName}:${viewer.phone}`}
      name={viewer.fullName ?? ""}
    >
      <div className="flex flex-col gap-2">
        <p className="text-14 font-bold">{t("phone")}</p>
        <div className="flex min-h-14 items-center gap-3 rounded-input border border-border bg-surface px-4">
          <span dir="ltr" className="flex-1 text-end text-16 font-bold">
            {formatPhone(viewer.phone)}
          </span>
          <Link
            href={routes.changePhone}
            className="flex min-h-11 items-center text-14 font-bold text-teal underline"
          >
            {t("changePhone")}
          </Link>
        </div>
        {phoneParam === "changed" && (
          <p role="status" className="flex items-center gap-1.5 text-14 font-bold text-ok-fg">
            <CircleCheck aria-hidden className="size-4.5 shrink-0" />
            {t("phoneChanged")}
          </p>
        )}
      </div>
    </EditNameForm>
  );
}

function EditSkeleton() {
  return (
    <SkeletonGroup className="flex flex-1 flex-col gap-6">
      <Skeleton className="h-22 w-full" />
      <Skeleton className="h-22 w-full" />
      <div className="flex-1" />
      <Skeleton className="h-14 w-full rounded-button" />
    </SkeletonGroup>
  );
}
