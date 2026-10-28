import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { requireViewer } from "@/lib/auth/viewer";
import { routes, safeNext, withNext } from "@/lib/routes";
import { addressLabels, type AddressLabel } from "@/lib/schemas/address";
import { createClient } from "@/lib/supabase/server";

import { AddressMessage } from "../address-message";
import { LocationEditor } from "../location-editor";
import { LocationSkeleton } from "../location-skeleton";

/** Location for a new address (spec §5.4), in onboarding or from the picker (N2). */
export default function NewAddressPage({ searchParams }: PageProps<"/addresses/new">) {
  return (
    <Suspense fallback={<LocationSkeleton />}>
      <NewAddress searchParams={searchParams} />
    </Suspense>
  );
}

async function NewAddress({ searchParams }: Pick<PageProps<"/addresses/new">, "searchParams">) {
  const params = await searchParams;
  const onboarding = params.onboarding === "1";
  const next = safeNext(params.next);
  const self = withNext(`${routes.newAddress}${onboarding ? "?onboarding=1" : ""}`, next);
  await requireViewer(self);

  const supabase = await createClient();
  const [{ data, error }, settings] = await Promise.all([
    supabase.from("addresses").select("label"),
    supabase.from("settings").select("company_phone").single(),
  ]);
  if (error) throw new Error(`Addresses read failed: ${error.message}`);
  const usedLabels: AddressLabel[] = data.map((row) => row.label);
  const back = next ?? routes.home;

  if (addressLabels.every((label) => usedLabels.includes(label))) {
    const t = await getTranslations("Location");
    return (
      <AddressMessage
        title={t("allLabelsUsedTitle")}
        description={t("allLabelsUsedBody")}
        cta={t("allLabelsUsedCta")}
        href={back}
      />
    );
  }

  return (
    <LocationEditor
      // Next keeps recently visited pages alive; a new key per set of
      // labels gives a fresh form once an address has been added.
      key={usedLabels.join()}
      address={null}
      usedLabels={usedLabels}
      onboarding={onboarding}
      backHref={back}
      next={back}
      supportPhone={settings.data?.company_phone ?? null}
    />
  );
}
