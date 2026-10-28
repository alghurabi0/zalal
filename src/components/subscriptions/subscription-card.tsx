import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { baghdadToday, formatDayMonth } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { routes } from "@/lib/routes";
import { nextVisit, type Subscription } from "@/lib/subscriptions/state";

/**
 * Profile's subscription card (Profile.dc.html, spec §5.8): the canvas's
 * navy card for an active subscription (visits left, the next visit, the
 * end), and the same card with one line for the other states: none (or
 * declined, cancelled) with "اشترك", requested ("قيد المراجعة"), expired
 * with "جدّد الاشتراك". The whole card opens Subscription (N8) for its
 * address. `addressLine` names the address when the customer has several.
 */
export async function SubscriptionCard({
  subscription,
  addressId,
  addressLine,
  intervalMonths,
  link = true,
}: {
  subscription: Subscription | null;
  addressId: string | null;
  /** "البيت · حي الحسين", when the customer has more than one address. */
  addressLine?: string;
  intervalMonths: number;
  /** False on N8 itself, where the card shows the subscription it opens. */
  link?: boolean;
}) {
  const t = await getTranslations("Subscription.card");
  const state = subscription?.state;
  const running = state === "active" || state === "upcoming";
  const pill =
    state === "active" || state === "upcoming" || state === "requested" || state === "expired"
      ? t(`states.${state}`)
      : null;

  const next = running && subscription ? nextVisit(subscription, intervalMonths) : null;
  const nextText = !next
    ? t("none")
    : next.kind === "booked"
      ? formatDayMonth(baghdadToday(new Date(next.at)))
      : formatDayMonth(next.day);

  const className = "flex flex-col gap-3.5 rounded-20 bg-navy p-4.5 text-white";
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-18 font-extrabold">{t("title")}</span>
          {addressLine && <span className="text-13 text-on-dark-muted">{addressLine}</span>}
        </span>
        {pill && (
          <span
            className={
              state === "expired"
                ? "rounded-10 bg-navy-2 px-2.5 py-0.5 text-13 font-extrabold text-on-dark-body"
                : "rounded-10 bg-aqua px-2.5 py-0.5 text-13 font-extrabold text-navy"
            }
          >
            {pill}
          </span>
        )}
      </div>

      {running && subscription ? (
        <dl className="grid grid-cols-3 gap-2">
          <div className="flex flex-col">
            <dt className="text-13 text-on-dark-muted">{t("visitsLeft")}</dt>
            <dd className="text-22 font-black">
              {t("visitsValue", { left: subscription.visitsLeft, total: subscription.visitsTotal })}
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-13 text-on-dark-muted">{t("next")}</dt>
            <dd className="text-16 leading-tight font-extrabold">{nextText}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-13 text-on-dark-muted">
              {state === "upcoming" ? t("starts") : t("ends")}
            </dt>
            <dd className="text-16 leading-tight font-extrabold">
              {formatDayMonth(
                (state === "upcoming" ? subscription.startsOn : subscription.endsOn) ?? "",
              )}
            </dd>
          </div>
        </dl>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-15 text-on-dark-body">
            {state === "requested"
              ? t("requestedBody")
              : state === "expired"
                ? t("expiredBody")
                : t("noneBody")}
          </span>
          {state !== "requested" && (
            <span className="flex shrink-0 items-center gap-1 text-15 font-extrabold text-aqua">
              {state === "expired" ? t("expiredCta") : t("noneCta")}
              <ChevronRight aria-hidden className="size-4.5 rtl:-scale-x-100" />
            </span>
          )}
        </div>
      )}
    </>
  );

  if (!link) {
    return (
      <div className={className} data-testid="subscription-card">
        {content}
      </div>
    );
  }
  return (
    <Link
      href={addressId ? routes.subscriptionFor(addressId) : routes.subscription}
      className={cn(className, "focus-visible:outline-teal")}
      data-testid="subscription-card"
    >
      {content}
    </Link>
  );
}
