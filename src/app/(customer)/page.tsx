import { ChevronDown, MapPin } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Screen } from "@/components/layout/screen";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { TabBar } from "@/components/ui/tab-bar";
import { chosenAddress, listAddresses } from "@/lib/addresses";
import { getViewer, surfaceFor } from "@/lib/auth/viewer";
import { baghdadHour } from "@/lib/dates";
import { routes } from "@/lib/routes";

import { AddressPicker } from "./addresses/address-picker";
import { HomeCards, HomeCardsSkeleton } from "./home-cards";

/**
 * Home (Home.dc.html, spec §5.5): the header with the address picker (N2) or,
 * for guests, "سجّل دخول"; the greeting; the cards (home-cards.tsx); the tab
 * bar. The bell, quick actions and tips strip come with their phases.
 */
export default function HomePage() {
  return (
    <Screen className="bg-bg">
      <Suspense fallback={<HomeSkeleton />}>
        <HomeHeader />
      </Suspense>
      {/* The first card overlaps the navy header, as in the design. */}
      <div className="-mt-10 flex flex-1 flex-col gap-3 px-4 pb-6">
        <Suspense fallback={<HomeCardsSkeleton />}>
          <HomeCards />
        </Suspense>
      </div>
      <TabBar active="home" />
    </Screen>
  );
}

async function HomeHeader() {
  const t = await getTranslations("Home");
  const viewer = await getViewer();
  if (viewer && viewer.role !== "customer") redirect(surfaceFor(viewer.role));

  const hour = baghdadHour();
  const greeting = hour >= 4 && hour < 12 ? t("greetingMorning") : t("greetingEvening");
  const firstName = viewer?.fullName?.split(" ")[0];

  return (
    <header className="flex flex-col gap-6 bg-navy px-5 pt-5 pb-13.5 text-white">
      <div className="flex min-h-11 items-center">
        {viewer ? <AddressButton /> : <GuestLogin label={t("login")} />}
      </div>
      <div className="flex flex-col">
        <p className="text-16 text-on-dark-muted">
          {firstName ? t("greetingName", { greeting, name: firstName }) : greeting}
        </p>
        <h1 className="text-28 leading-snug font-black">{t("headline")}</h1>
      </div>
    </header>
  );
}

function GuestLogin({ label }: { label: string }) {
  return (
    <Link
      href={routes.login}
      className="flex h-11 items-center rounded-full bg-aqua px-4 text-15 font-extrabold text-navy focus-visible:outline-aqua"
    >
      {label}
    </Link>
  );
}

async function AddressButton() {
  const t = await getTranslations("Home");
  const tLabels = await getTranslations("Location.labels");
  const addresses = await listAddresses();
  const current = await chosenAddress(addresses);

  return (
    <AddressPicker
      addresses={addresses}
      mode="select"
      selectedId={current?.id}
      returnTo={routes.home}
    >
      <button
        type="button"
        aria-label={current ? undefined : t("addAddress")}
        className="flex min-h-11 items-center gap-2 text-start focus-visible:outline-aqua"
      >
        <MapPin aria-hidden className="size-6 shrink-0 text-aqua" strokeWidth={2} />
        <span className="flex flex-col leading-tight">
          <span className="text-13 text-on-dark-muted">{t("deliverTo")}</span>
          <span className="text-16 font-extrabold">
            {current
              ? t("addressLine", { label: tLabels(current.label), district: current.district })
              : t("addAddress")}
          </span>
        </span>
        <ChevronDown aria-hidden className="size-4.5 shrink-0" strokeWidth={2.2} />
        {current && <span className="sr-only">{t("changeAddress")}</span>}
      </button>
    </AddressPicker>
  );
}

function HomeSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-6 bg-navy px-5 pt-5 pb-13.5">
      <Skeleton className="h-11 w-48 bg-navy-2" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-32 bg-navy-2" />
        <Skeleton className="h-9 w-64 bg-navy-2" />
      </div>
    </SkeletonGroup>
  );
}
