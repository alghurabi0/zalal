import * as Sentry from "@sentry/nextjs";
import {
  CalendarCheck,
  CalendarClock,
  Clock,
  House,
  type LucideIcon,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Star,
  TriangleAlert,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { GroundTankIcon, RoofTankIcon } from "@/components/icons/tank-icons";
import { LiveOrders } from "@/components/orders/live-orders";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { chosenAddress, listAddresses } from "@/lib/addresses";
import { homeArticles } from "@/lib/articles/queries";
import { getViewer } from "@/lib/auth/viewer";
import { cn } from "@/lib/cn";
import { formatDate, serviceDayParts, slotParts } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { activeOrder, type OrderSummary } from "@/lib/orders/queries";
import { actionHref, primaryAction } from "@/lib/orders/status";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { tankStatus, type TankStatus } from "@/lib/tanks/status";

/**
 * Home's cards (Home.dc.html, spec §5.5). Customers: the active-order card
 * (live) and the tank status card. Guests: the price list with a book button,
 * which goes through login. Customers also get the quick actions row.
 * Everyone: the tips strip.
 */
export async function HomeCards() {
  const viewer = await getViewer();
  if (!viewer) {
    return (
      <>
        <PriceListCard />
        <TipsStrip />
      </>
    );
  }
  // Staff are sent to their surface by the header.
  if (viewer.role !== "customer") return null;

  const [order, tank] = await Promise.all([activeOrder(new Date()), chosenTankStatus()]);
  return (
    <>
      <LiveOrders customerId={viewer.id} />
      {order && <ActiveOrderCard order={order} />}
      <TankCard status={tank.status} interval={tank.interval} />
      <QuickActions />
      <TipsStrip />
    </>
  );
}

type ActiveStatus =
  "pending_confirmation" | "confirmed" | "postponed" | "on_the_way" | "arrived" | "in_progress";

const activeLook: Record<ActiveStatus, { icon: LucideIcon; well: string }> = {
  pending_confirmation: { icon: Clock, well: "bg-selected text-teal" },
  confirmed: { icon: CalendarCheck, well: "bg-selected text-teal" },
  postponed: { icon: CalendarClock, well: "bg-warn-bg text-warn-icon" },
  on_the_way: { icon: Truck, well: "bg-warn-bg text-warn-icon" },
  arrived: { icon: House, well: "bg-warn-bg text-warn-icon" },
  in_progress: { icon: Sparkles, well: "bg-warn-bg text-warn-icon" },
};

/**
 * The soonest order from pending to in progress, with copy by status. It
 * opens Tracking while the crew is on the way (تتبّع, as in Home.dc.html),
 * Job progress once it has arrived, and Order details before that.
 */
async function ActiveOrderCard({ order }: { order: OrderSummary }) {
  const t = await getTranslations("Home.activeOrder");
  const tBooking = await getTranslations("Booking");
  const status = order.status as ActiveStatus;
  const { icon: Icon, well } = activeLook[status];
  const { weekday, day } = serviceDayParts(order.service_date);
  const when = t("when", {
    weekday,
    day,
    slot: tBooking("slot", slotParts(order.slot_start_at, order.slot_end_at)),
  });
  const num = (chunks: ReactNode) => <span dir="ltr">{chunks}</span>;
  const action = primaryAction(status);
  const href = actionHref(action, order.id);

  return (
    <Card
      variant="raised"
      href={href}
      className="flex items-center gap-3 p-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
    >
      <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-input", well)}>
        <Icon aria-hidden className="size-6.5" strokeWidth={2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="sr-only">{t("label")}: </span>
        <span className="text-15 font-extrabold">
          {status === "confirmed" ? t("confirmed", { when }) : t(status)}
        </span>
        <span className="text-13 text-muted">
          {status === "pending_confirmation"
            ? t.rich("numberWhen", { number: order.number, when, num })
            : t.rich("number", { number: order.number, num })}
        </span>
      </span>
      <span className="text-14 font-extrabold text-teal">
        {action === "track" ? t("track") : action === "progress" ? t("progress") : t("open")}
      </span>
    </Card>
  );
}

async function chosenTankStatus(): Promise<{ status: TankStatus; interval: number }> {
  const supabase = await createClient();
  const [address, settings] = await Promise.all([
    listAddresses().then(chosenAddress),
    supabase.from("settings").select("cleaning_interval_months").single(),
  ]);
  if (settings.error) throw new Error(`Settings read failed: ${settings.error.message}`);
  const interval = settings.data.cleaning_interval_months;
  if (!address) return { status: { health: "no_history" }, interval };

  const { data, error } = await supabase
    .from("tanks")
    .select("last_cleaned_at")
    .eq("address_id", address.id);
  if (error) throw new Error(`Tanks read failed: ${error.message}`);
  return { status: tankStatus(data, new Date(), interval), interval };
}

/** حالة خزانك, for the chosen address and the tank due soonest. */
async function TankCard({ status, interval }: { status: TankStatus; interval: number }) {
  const t = await getTranslations("Home.tank");
  const healthy = status.health === "ok";

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-16 font-extrabold">{t("title")}</h2>
        {status.health !== "no_history" && (
          <span
            className={cn(
              "rounded-10 px-2.5 py-0.5 text-12 font-extrabold",
              healthy ? "bg-ok-bg text-ok-fg" : "bg-warn-bg text-warn-fg",
            )}
          >
            {t(status.health)}
          </span>
        )}
      </div>
      {status.health === "no_history" ? (
        <div className="flex flex-col">
          <p className="text-15 font-bold">{t("noHistory")}</p>
          <p className="text-13 text-muted">{t("noHistoryBody")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-border">
            <div
              className={cn("rounded-full", healthy ? "bg-ok" : "bg-warn")}
              style={{ width: `${Math.round(status.fill * 100)}%` }}
            />
          </div>
          <div className="flex justify-between gap-2 text-13 text-muted">
            <span>{t("lastCleaned", { months: status.monthsSince })}</span>
            <span>
              {healthy
                ? t("nextDue", { date: formatDate(status.nextDueAt) })
                : t("every", { months: interval })}
            </span>
          </div>
        </div>
      )}
      <Button href={routes.book} size="card" className="w-full">
        {t("book")}
      </Button>
    </Card>
  );
}

const typeIcons = { roof: RoofTankIcon, ground: GroundTankIcon } as const;

/** Guests: the fixed prices (spec decision 11) and a book button through login. */
async function PriceListCard() {
  const t = await getTranslations("Home.prices");
  const tTanks = await getTranslations("Tanks");
  const tUI = await getTranslations("UI");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("price_list")
    .select("tank_type, size, price_iqd")
    .order("tank_type")
    .order("size");
  if (error) throw new Error(`Prices read failed: ${error.message}`);

  return (
    <Card variant="raised" className="flex flex-col gap-3 p-4">
      <div className="flex flex-col">
        <h2 className="text-16 font-extrabold">{t("title")}</h2>
        <p className="text-13 text-muted">{t("body")}</p>
      </div>
      <ul className="flex flex-col">
        {data.map((row) => {
          const Icon = typeIcons[row.tank_type];
          return (
            <li
              key={`${row.tank_type}-${row.size}`}
              className="flex items-center gap-2.5 border-b border-divider py-2 last:border-0"
            >
              <Icon className="size-5 shrink-0 text-teal" strokeWidth={2} />
              <span className="flex-1 text-14">
                {t("row", {
                  type: tTanks(`types.${row.tank_type}`),
                  size: tTanks(`sizes.${row.size}`),
                })}
              </span>
              <span className="text-14 font-extrabold whitespace-nowrap">
                {tUI("iqd", { amount: formatIQD(row.price_iqd) })}
              </span>
            </li>
          );
        })}
      </ul>
      <Button href={routes.book} size="card" className="w-full">
        {t("book")}
      </Button>
    </Card>
  );
}

/**
 * معلومات تهمك: the 2 newest featured articles (filled with the newest
 * others), the first on navy-2 as in the canvas; hidden when none is
 * published. A failed read only hides it: Home's cards matter more.
 */
async function TipsStrip() {
  const articles = await homeArticles().catch((error: unknown) => {
    Sentry.captureException(error);
    return [];
  });
  if (articles.length === 0) return null;
  const t = await getTranslations("Home.tips");

  return (
    <section aria-labelledby="home-tips" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="home-tips" className="text-16 font-extrabold">
          {t("title")}
        </h2>
        <Link
          href={routes.tips}
          className="flex min-h-11 items-center text-14 font-bold text-teal hover:text-navy focus-visible:outline-teal"
        >
          {t("seeAll")}
        </Link>
      </div>
      <ul className="flex gap-2.5">
        {articles.map((article, i) => (
          <li key={article.id} className="flex min-w-0 flex-1">
            <Link
              href={routes.article(article.slug)}
              className={cn(
                "flex flex-1 flex-col gap-1 rounded-button p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
                i === 0 ? "bg-navy-2 text-white" : "border border-border bg-surface text-navy",
              )}
            >
              <span className={cn("text-12 font-bold", i === 0 ? "text-aqua" : "text-teal")}>
                {article.category.name}
              </span>
              <span className="text-14 leading-normal font-extrabold">{article.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const quickActions = [
  { key: "subscription", href: routes.subscription, icon: Star },
  { key: "certificates", href: routes.certificates, icon: ShieldCheck },
  { key: "chat", href: routes.chat, icon: MessageSquare },
  { key: "issue", href: routes.issue, icon: TriangleAlert },
] as const;

/**
 * The quick actions row (Home.dc.html, spec §5.5; customers only): Subscription
 * (N8), Certificates (N12), Chat and Issue report, as 58 px white tiles.
 */
async function QuickActions() {
  const t = await getTranslations("Home.quick");
  return (
    <nav aria-label={t("label")} className="py-1">
      <ul className="grid grid-cols-4 gap-2">
        {quickActions.map(({ key, href, icon: Icon }) => (
          <li key={key}>
            <Link
              href={href}
              className="flex flex-col items-center gap-1.5 rounded-chip text-center text-12 font-bold"
            >
              <span className="flex size-14.5 items-center justify-center rounded-card border border-border bg-surface text-teal">
                <Icon aria-hidden className="size-6.5" strokeWidth={2} />
              </span>
              {t(key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function HomeCardsSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-3">
      <Skeleton className="h-19 rounded-card bg-surface shadow-card" />
      <Skeleton className="h-44 rounded-card bg-surface" />
    </SkeletonGroup>
  );
}
