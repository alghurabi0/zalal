import { MapPin, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { GroundTankIcon, RoofTankIcon } from "@/components/icons/tank-icons";
import { Screen } from "@/components/layout/screen";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { listAddresses } from "@/lib/addresses";
import { requireViewer } from "@/lib/auth/viewer";
import { addMonths, formatDate } from "@/lib/dates";
import { routes, withNext } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

import { DeleteTankButton } from "./delete-tank-button";
import { TankFormSheet } from "./tank-form-sheet";

const typeIcons = { roof: RoofTankIcon, ground: GroundTankIcon } as const;

/**
 * My tanks (N3): grouped by address, with type, size, nickname, last
 * cleaned and next due; add, edit, delete.
 */
export default async function TanksPage() {
  const t = await getTranslations("Tanks");
  return (
    <Screen className="gap-5 px-5 pt-5 pb-safe-8">
      <div className="flex items-center gap-3">
        <BackButton href={routes.profile} />
        <h1 className="text-20 font-black">{t("title")}</h1>
      </div>
      <Suspense fallback={<TanksSkeleton />}>
        <TanksContent />
      </Suspense>
    </Screen>
  );
}

async function TanksContent() {
  const t = await getTranslations("Tanks");
  const tLabels = await getTranslations("Location.labels");
  await requireViewer(routes.tanks);
  const supabase = await createClient();
  const [addresses, tanks, settings] = await Promise.all([
    listAddresses(),
    supabase
      .from("tanks")
      .select("id, address_id, type, size, nickname, last_cleaned_at")
      .order("created_at"),
    supabase.from("settings").select("cleaning_interval_months").single(),
  ]);
  if (tanks.error) throw new Error(`Tanks read failed: ${tanks.error.message}`);
  if (settings.error) throw new Error(`Settings read failed: ${settings.error.message}`);
  const interval = settings.data.cleaning_interval_months;

  if (addresses.length === 0) {
    return (
      <EmptyState
        icon={MapPin}
        title={t("noAddressTitle")}
        description={t("noAddressBody")}
        action={
          <Button href={withNext(routes.newAddress, routes.tanks)} size="footer" className="w-full">
            {t("noAddressCta")}
          </Button>
        }
      />
    );
  }

  const sheetAddresses = addresses.map(({ id, label, district }) => ({ id, label, district }));

  return (
    <div className="flex flex-col gap-6">
      {addresses.map((address) => {
        const atAddress = tanks.data.filter((tank) => tank.address_id === address.id);
        const headingId = `address-${address.id}`;
        return (
          <section key={address.id} aria-labelledby={headingId} className="flex flex-col gap-2.5">
            <h2 id={headingId} className="flex flex-col">
              <span className="text-16 font-extrabold">
                {tLabels(address.label)} · {address.district}
              </span>
              <span className="text-13 text-muted">{address.landmark}</span>
            </h2>

            {atAddress.length === 0 ? (
              <p className="text-14 text-muted">{t("noTanksAtAddress")}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {atAddress.map((tank) => {
                  const Icon = typeIcons[tank.type];
                  const typeName = t(`types.${tank.type}`);
                  const name = tank.nickname ?? typeName;
                  return (
                    <li key={tank.id}>
                      <Card className="flex flex-col gap-1 px-3.5 pt-3.5 pb-1">
                        <div className="flex items-start gap-3">
                          <span className="flex size-11 shrink-0 items-center justify-center rounded-chip bg-selected text-teal">
                            <Icon className="size-6" />
                          </span>
                          <div className="flex min-w-0 flex-col">
                            <span className="text-16 font-extrabold">{name}</span>
                            <span className="text-13 text-muted">
                              {tank.nickname ? `${typeName} · ` : ""}
                              {t(`sizes.${tank.size}`)}
                            </span>
                            <span className="text-13 text-body-2">
                              {tank.last_cleaned_at
                                ? t("lastCleaned", { date: formatDate(tank.last_cleaned_at) })
                                : t("neverCleaned")}
                            </span>
                            {tank.last_cleaned_at && (
                              <span className="text-13 text-body-2">
                                {t("nextDue", {
                                  date: formatDate(addMonths(tank.last_cleaned_at, interval)),
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="-ms-2 flex flex-wrap items-center border-t border-divider">
                          <TankFormSheet
                            addresses={sheetAddresses}
                            addressId={address.id}
                            tank={{
                              id: tank.id,
                              addressId: tank.address_id,
                              type: tank.type,
                              size: tank.size,
                              nickname: tank.nickname,
                            }}
                          >
                            <Button
                              variant="link"
                              size="sm"
                              className="px-2"
                              aria-label={`${t("edit")} ${name}`}
                            >
                              {t("edit")}
                            </Button>
                          </TankFormSheet>
                          <DeleteTankButton tankId={tank.id} name={name} />
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}

            <TankFormSheet addresses={sheetAddresses} addressId={address.id}>
              <Button variant="secondary" size="sm" className="self-start">
                <Plus aria-hidden className="size-4.5 text-teal" strokeWidth={2.4} />
                {t("add")}
              </Button>
            </TankFormSheet>
          </section>
        );
      })}
    </div>
  );
}

function TanksSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-3">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-28 w-full rounded-card" />
      <Skeleton className="h-28 w-full rounded-card" />
      <Skeleton className="h-11 w-32" />
    </SkeletonGroup>
  );
}
