import {
  ChevronRight,
  CreditCard,
  LogOut,
  type LucideIcon,
  MapPin,
  MessageSquareWarning,
  Settings,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { type ComponentProps, Suspense } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { RoofTankIcon } from "@/components/icons/tank-icons";
import { Screen } from "@/components/layout/screen";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { CustomerTabBar } from "@/components/chat/customer-tab-bar";
import { LiveSubscriptions } from "@/components/subscriptions/live-subscriptions";
import { SubscriptionCard } from "@/components/subscriptions/subscription-card";
import { chosenAddress, listAddresses } from "@/lib/addresses";
import { requireViewer } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { companyPhones, formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { listSubscriptions, subscriptionPlan } from "@/lib/subscriptions/queries";
import { currentFor, type Subscription } from "@/lib/subscriptions/state";

import { AddressPicker, type AddressSummary } from "../addresses/address-picker";
import { RemindersSwitch } from "./reminders-switch";
import { WhatsAppRow } from "./whatsapp-row";

/**
 * Profile (Profile.dc.html, spec §5.8): name and phone with "تعديل" (N10),
 * the subscription card (one per address with a subscription, else one for
 * the chosen address), then the rows: My addresses (N2), My tanks (N3), the
 * read-only payment row, Certificates (N12), My reports (N11), Settings
 * (N13) and the reminder toggle; then help (Chat), WhatsApp (when a company
 * phone is set) and logout.
 */
export default function ProfilePage() {
  return (
    <Screen>
      <Suspense fallback={<ProfileSkeleton />}>
        <ProfileContent />
      </Suspense>
      <div className="flex-1" />
      <CustomerTabBar active="profile" />
    </Screen>
  );
}

async function ProfileContent() {
  const t = await getTranslations("Profile");
  const tSubscription = await getTranslations("Subscription");
  const tLabels = await getTranslations("Location.labels");
  const viewer = await requireViewer(routes.profile);
  const supabase = await createClient();
  const [addresses, tanks, openTickets, certificates, profile, subscriptions, plan, settings] =
    await Promise.all([
      listAddresses(),
      supabase.from("tanks").select("id", { count: "exact", head: true }),
      supabase.from("tickets").select("id", { count: "exact", head: true }).neq("status", "closed"),
      // RLS shows the certificates of the customer's completed orders.
      supabase.from("certificates").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("reminders_enabled").eq("id", viewer.id).single(),
      listSubscriptions(),
      subscriptionPlan(),
      supabase.from("settings").select("company_phone, company_phone_2").single(),
    ]);
  if (tanks.error) throw new Error(`Tanks count failed: ${tanks.error.message}`);
  if (openTickets.error) throw new Error(`Tickets count failed: ${openTickets.error.message}`);
  if (certificates.error) {
    throw new Error(`Certificates count failed: ${certificates.error.message}`);
  }
  if (profile.error) throw new Error(`Profile read failed: ${profile.error.message}`);
  if (settings.error) throw new Error(`Settings read failed: ${settings.error.message}`);
  const tankCount = tanks.count ?? 0;
  const name = viewer.fullName ?? "";

  // One card per address whose subscription is running, asked for or
  // expired; with none, one card for the chosen address (Home's).
  const cards: { address: AddressSummary | null; subscription: Subscription | null }[] = addresses
    .map((address) => ({ address, subscription: currentFor(subscriptions, address.id) }))
    .filter(
      ({ subscription }) =>
        subscription && subscription.state !== "declined" && subscription.state !== "cancelled",
    );
  const chosen = await chosenAddress(addresses);
  if (cards.length === 0) cards.push({ address: chosen ?? null, subscription: null });

  return (
    <div className="flex flex-col gap-4 px-5 pt-5 pb-6">
      <h1 className="sr-only">{t("title")}</h1>
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-navy text-26 font-black text-aqua"
        >
          {name.charAt(0)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-22 font-black">{name}</p>
          <p dir="ltr" className="text-end text-15 text-muted">
            {formatPhone(viewer.phone)}
          </p>
        </div>
        <Link
          href={routes.editProfile}
          aria-label={t("editLabel")}
          className="flex min-h-11 items-center px-1 text-15 font-bold text-teal underline"
        >
          {t("edit")}
        </Link>
      </div>

      <LiveSubscriptions userId={viewer.id} />
      {cards.map(({ address, subscription }) => (
        <SubscriptionCard
          key={address?.id ?? "none"}
          subscription={subscription}
          addressId={address?.id ?? null}
          addressLine={
            address && addresses.length > 1
              ? tSubscription("addressLine", {
                  label: tLabels(address.label),
                  district: address.district,
                })
              : undefined
          }
          intervalMonths={plan.cleaningIntervalMonths}
        />
      ))}

      <Card className="overflow-hidden">
        <ul className="divide-y divide-divider">
          <li>
            <AddressPicker addresses={addresses} mode="manage" returnTo={routes.profile}>
              <Row
                as="button"
                icon={MapPin}
                label={t("addresses")}
                value={String(addresses.length)}
              />
            </AddressPicker>
          </li>
          <li>
            <Row
              as="link"
              href={routes.tanks}
              icon={RoofTankIcon}
              label={t("tanks")}
              value={t("tankCount", { n: tankCount, count: String(tankCount) })}
            />
          </li>
          <li>
            <Row icon={CreditCard} label={t("payment")} value={t("paymentValue")} />
          </li>
          <li>
            <Row
              as="link"
              href={routes.certificates}
              icon={ShieldCheck}
              label={t("certificates")}
              value={certificates.count ? String(certificates.count) : ""}
            />
          </li>
          <li>
            <Row
              as="link"
              href={routes.reports}
              icon={MessageSquareWarning}
              label={t("reports")}
              value={
                openTickets.count
                  ? t("openReports", { n: openTickets.count, count: String(openTickets.count) })
                  : ""
              }
            />
          </li>
          <li>
            <Row as="link" href={routes.settings} icon={Settings} label={t("settings")} value="" />
          </li>
          <li>
            <RemindersSwitch enabled={profile.data.reminders_enabled} />
          </li>
        </ul>
      </Card>

      <Card className="overflow-hidden">
        <Link
          href={routes.chat}
          className="flex min-h-14 w-full items-center border-b border-divider px-4 text-17 font-extrabold"
        >
          {t("help")}
        </Link>
        <WhatsAppRow phones={companyPhones(settings.data)} />
        <LogoutButton>
          <button
            type="button"
            className="flex min-h-14 w-full items-center gap-3 px-4 text-start text-17 font-extrabold text-danger"
          >
            <LogOut aria-hidden className="size-5.5 rtl:-scale-x-100" strokeWidth={2} />
            {t("logout")}
          </button>
        </LogoutButton>
      </Card>
    </div>
  );
}

type RowProps = {
  icon: LucideIcon | typeof RoofTankIcon;
  label: string;
  value: string;
} & (
  | ({ as: "button" } & Omit<ComponentProps<"button">, "children">)
  | { as: "link"; href: string }
  | { as?: undefined }
);

/**
 * A Profile row: icon, label, value and a chevron (Profile.dc.html). Without
 * `as` it is read-only text, with no chevron (the payment row).
 */
function Row({ icon: Icon, label, value, ...props }: RowProps) {
  const classes = "flex min-h-14 w-full items-center gap-3 px-4 text-start";
  const content = (
    <>
      <Icon aria-hidden className="size-6 shrink-0 text-teal" strokeWidth={2} />
      <span className="flex-1 text-17 font-extrabold">{label}</span>
      <span className="text-15 text-muted">{value}</span>
      {props.as && (
        <ChevronRight aria-hidden className="size-5 shrink-0 text-control-off rtl:-scale-x-100" />
      )}
    </>
  );
  if (!props.as) return <div className={classes}>{content}</div>;
  if (props.as === "link") {
    return (
      <Link href={props.href} className={classes}>
        {content}
      </Link>
    );
  }
  const { as, className, ...button } = props;
  void as;
  return (
    <button type="button" {...button} className={cn(classes, className)}>
      {content}
    </button>
  );
}

function ProfileSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-4 px-5 pt-5">
      <div className="flex items-center gap-3.5">
        <Skeleton className="size-16 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <Skeleton className="h-42 w-full rounded-card" />
      <Skeleton className="h-14 w-full rounded-card" />
    </SkeletonGroup>
  );
}
