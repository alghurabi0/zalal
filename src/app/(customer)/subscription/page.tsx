import { Check, MapPin, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Screen } from "@/components/layout/screen";
import { LiveSubscriptions } from "@/components/subscriptions/live-subscriptions";
import { SubscriptionCard } from "@/components/subscriptions/subscription-card";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { chosenAddress, listAddresses } from "@/lib/addresses";
import { getViewer, surfaceFor } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { formatDay, formatDayTime } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { routes, withNext } from "@/lib/routes";
import {
  listSubscriptions,
  type SubscriptionPlan,
  subscriptionPlan,
} from "@/lib/subscriptions/queries";
import { canRequest, currentFor, hasRenewal } from "@/lib/subscriptions/state";

import { BookVisitButton } from "./book-button";
import { RequestButton } from "./request-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Subscription");
  return { title: t("title") };
}

/**
 * Subscription (N8, spec §5 new screens; Phase 6, task 2), guests too. One
 * subscription per address (settled Oct 28, 2026): the address comes from
 * `?address=`, else Home's choice, with chips when there are several. The
 * plan card (price and contents from settings) with "اطلب الاشتراك", then
 * the status: requested, active (the Profile card, the period, the next
 * visit, "احجز زيارة" and, from 30 days before the end, "جدّد الاشتراك"),
 * expired, declined or cancelled. Guests see the plan and go through login.
 * Live through Realtime. No tab bar.
 */
export default function SubscriptionPage(props: PageProps<"/subscription">) {
  return (
    <Screen className="bg-bg">
      <Suspense fallback={<SubscriptionSkeleton />}>
        <SubscriptionContent {...props} />
      </Suspense>
    </Screen>
  );
}

async function SubscriptionContent({ searchParams }: PageProps<"/subscription">) {
  const t = await getTranslations("Subscription");
  const viewer = await getViewer();
  if (viewer && viewer.role !== "customer") redirect(surfaceFor(viewer.role));
  // Started together; the customer's reads are skipped for guests.
  const planRead = subscriptionPlan();
  const customerReads = viewer
    ? Promise.all([listAddresses(), listSubscriptions()])
    : Promise.resolve(null);
  const plan = await planRead;
  const header = <Header title={t("title")} back={viewer ? routes.profile : routes.home} />;

  if (!viewer) {
    return (
      <>
        {header}
        <Body>
          <PlanCard plan={plan} />
          {plan.priceIqd !== null && (
            <Button
              href={withNext(routes.login, routes.subscription)}
              size="footer"
              className="w-full"
            >
              {t("request")}
            </Button>
          )}
        </Body>
      </>
    );
  }

  const [addresses, subscriptions] = (await customerReads) ?? [[], []];
  if (addresses.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={MapPin}
          title={t("noAddressTitle")}
          description={t("noAddressBody")}
          action={
            <Button
              href={withNext(routes.newAddress, routes.subscription)}
              size="footer"
              className="w-full"
            >
              {t("noAddressCta")}
            </Button>
          }
        />
      </>
    );
  }

  const asked = (await searchParams).address;
  const address =
    addresses.find((a) => a.id === asked) ?? (await chosenAddress(addresses)) ?? addresses[0]!;
  const current = currentFor(subscriptions, address.id);
  const state = current?.state ?? null;
  const running = state === "active" || state === "upcoming";
  const requestable = plan.priceIqd !== null && canRequest(subscriptions, address.id);
  const renewal = hasRenewal(subscriptions, current);

  return (
    <>
      {header}
      <LiveSubscriptions userId={viewer.id} />
      <Body>
        {addresses.length > 1 && <AddressChips addresses={addresses} selected={address.id} />}

        {running && current && (
          <>
            <SubscriptionCard
              subscription={current}
              addressId={address.id}
              intervalMonths={plan.cleaningIntervalMonths}
              link={false}
            />
            <Card className="flex flex-col gap-2 px-4 py-3.5 text-15">
              {current.startsOn && current.endsOn && (
                <p className="text-muted">
                  {t("period", {
                    from: formatDay(current.startsOn),
                    to: formatDay(current.endsOn),
                  })}
                </p>
              )}
              {current.nextOrderId && current.nextOrderAt && (
                <Link
                  href={routes.order(current.nextOrderId)}
                  className="flex min-h-11 items-center justify-between gap-2 font-bold text-teal underline"
                >
                  <span>{t("nextBooked")}</span>
                  <span>{formatDayTime(current.nextOrderAt)}</span>
                </Link>
              )}
              {renewal && <p className="font-bold">{t("renewalRequested")}</p>}
            </Card>
            {current.visitsLeft > 0 && !current.nextOrderId && (
              <BookVisitButton addressId={address.id} label={t("book")} />
            )}
            {requestable && (
              <>
                <p className="text-center text-14 text-muted">{t("renewHint")}</p>
                <RequestButton addressId={address.id} label={t("renew")} />
              </>
            )}
          </>
        )}

        {state === "requested" && current && (
          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-18 font-extrabold">{t("requestedTitle")}</h2>
            <p className="text-15 text-body-2">
              {t("requestedBody", { date: formatDayTime(current.requestedAt) })}
            </p>
            <Button href={routes.chat} variant="secondary" size="card" className="w-full">
              <MessageCircle aria-hidden className="size-5" />
              {t("chat")}
            </Button>
          </Card>
        )}

        {!running && state !== "requested" && (
          <>
            {state === "expired" && current?.endsOn && (
              <StatusNote
                title={t("expiredTitle")}
                body={t("expiredBody", { date: formatDay(current.endsOn) })}
              />
            )}
            {state === "declined" && <StatusNote body={t("declinedBody")} />}
            {state === "cancelled" && current?.endedAt && (
              <StatusNote body={t("cancelledBody", { date: formatDayTime(current.endedAt) })} />
            )}
            <PlanCard plan={plan} />
            {requestable && (
              <RequestButton
                addressId={address.id}
                label={state === "expired" ? t("renew") : t("request")}
              />
            )}
          </>
        )}
      </Body>
    </>
  );
}

function Header({ title, back }: { title: string; back: string }) {
  return (
    <header className="flex items-center gap-3 px-5 pt-4.5 pb-3">
      <BackButton href={back} />
      <h1 className="text-22 font-black">{title}</h1>
    </header>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col gap-4 px-5 pb-safe-6">{children}</div>;
}

/** The plan from settings: price, visits, tanks covered, reminders, certificate. */
async function PlanCard({ plan }: { plan: SubscriptionPlan }) {
  const t = await getTranslations("Subscription");
  const tUI = await getTranslations("UI");
  const features = [
    t("features.visits", { count: plan.visits }),
    t("features.tanks", { count: plan.tanks }),
    t("features.reminders"),
    t("features.certificate"),
  ];
  return (
    <Card className="flex flex-col gap-4 p-4.5" data-testid="subscription-plan">
      <p className="text-15 text-body-2">{t("intro")}</p>
      {plan.priceIqd !== null ? (
        <p className="flex items-baseline gap-2">
          <span className="text-28 font-black">
            {tUI("iqd", { amount: formatIQD(plan.priceIqd) })}
          </span>
          <span className="text-15 text-muted">{t("perYear")}</span>
        </p>
      ) : (
        <p className="text-18 font-extrabold text-teal">{t("notOffered")}</p>
      )}
      <ul className="flex flex-col gap-2.5">
        {features.map((feature) => (
          <li key={feature} className="flex items-center gap-2.5 text-15 font-bold">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ok-bg text-ok-fg">
              <Check aria-hidden className="size-4" strokeWidth={3} />
            </span>
            {feature}
          </li>
        ))}
      </ul>
      {plan.priceIqd !== null && <p className="text-13 text-muted">{t("payment")}</p>}
    </Card>
  );
}

function StatusNote({ title, body }: { title?: string; body: string }) {
  return (
    <Card className="flex flex-col gap-1 border-warn bg-warn-bg p-4 text-warn-strong">
      {title && <h2 className="text-17 font-extrabold">{title}</h2>}
      <p className="text-15">{body}</p>
    </Card>
  );
}

async function AddressChips({
  addresses,
  selected,
}: {
  addresses: { id: string; label: "home" | "family" | "work"; district: string }[];
  selected: string;
}) {
  const t = await getTranslations("Subscription");
  const tLabels = await getTranslations("Location.labels");
  return (
    <nav aria-label={t("addressesLabel")} className="flex flex-wrap gap-2">
      {addresses.map((address) => {
        const on = address.id === selected;
        return (
          <Link
            key={address.id}
            href={routes.subscriptionFor(address.id)}
            replace
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center rounded-full border-2 px-4 text-14 font-bold",
              on ? "border-navy bg-navy text-white" : "border-border bg-surface text-muted",
            )}
          >
            {t("addressLine", { label: tLabels(address.label), district: address.district })}
          </Link>
        );
      })}
    </nav>
  );
}

function SubscriptionSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4 px-5 pt-4.5">
      <Skeleton className="h-11 w-48" />
      <Skeleton className="h-36 rounded-20" />
      <Skeleton className="h-48 rounded-card" />
      <Skeleton className="h-13.5 rounded-button" />
    </SkeletonGroup>
  );
}
