import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { requireViewer } from "@/lib/auth/viewer";
import { routes, safeNext, withNext } from "@/lib/routes";
import { addressIdSchema } from "@/lib/schemas/address";
import { createClient } from "@/lib/supabase/server";

import { AddressMessage } from "../../address-message";
import { LocationEditor } from "../../location-editor";
import { LocationSkeleton } from "../../location-skeleton";

/** Location for editing an address (spec §5.4), opened from the picker (N2). */
export default function EditAddressPage(props: PageProps<"/addresses/[id]/edit">) {
  return (
    <Suspense fallback={<LocationSkeleton />}>
      <EditAddress {...props} />
    </Suspense>
  );
}

async function EditAddress({ params, searchParams }: PageProps<"/addresses/[id]/edit">) {
  const { id } = await params;
  const next = safeNext((await searchParams).next);
  await requireViewer(withNext(routes.editAddress(id), next));
  const back = next ?? routes.home;

  const supabase = await createClient();
  const addressId = addressIdSchema.safeParse(id);
  const { data, error } = await supabase
    .from("addresses")
    .select("id, label, district, landmark, lat, lng");
  if (error) throw new Error(`Addresses read failed: ${error.message}`);
  const address = addressId.success ? data.find((row) => row.id === addressId.data) : undefined;

  if (!address) {
    const t = await getTranslations("Location");
    return (
      <AddressMessage
        title={t("notFoundTitle")}
        description={t("notFoundBody")}
        cta={t("allLabelsUsedCta")}
        href={back}
      />
    );
  }

  return (
    <LocationEditor
      // Next keeps recently visited pages alive: start from the saved values.
      key={`${address.id}:${address.label}:${address.district}:${address.landmark}:${address.lat}:${address.lng}`}
      address={address}
      usedLabels={data.filter((row) => row.id !== address.id).map((row) => row.label)}
      onboarding={false}
      backHref={back}
      next={back}
    />
  );
}
