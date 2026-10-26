"use client";

import { Calendar, type LucideIcon, MapPin, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentType, type SVGProps, useEffect, useRef, useState } from "react";

import { RoofTankIcon } from "@/components/icons/tank-icons";
import { Screen } from "@/components/layout/screen";
import { Button } from "@/components/ui/button";
import { findSlot } from "@/lib/booking/availability";
import {
  detailsComplete,
  draftTotal,
  lineTank,
  linePrice,
  orderItems,
  tankCount,
} from "@/lib/booking/draft";
import { type BookingError, stepFor } from "@/lib/booking/errors";
import { cn } from "@/lib/cn";
import { serviceDayParts, slotParts } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { routes } from "@/lib/routes";

import { createBooking } from "../actions";
import { BookingHeader } from "./booking-header";
import { useBooking } from "./booking-provider";
import { BookingSkeleton } from "./booking-skeleton";

const payments = ["cash", "zain", "card"] as const;

/**
 * Booking step 3 (Checkout.dc.html, spec §5.11): the summary with links back
 * to each step, cash payment (ZainCash and card "قريباً"), the price
 * breakdown and "أكّد الحجز", which waits for uploads, then creates the
 * order as pending_confirmation and opens Booking success (N5).
 */
export function ConfirmStep() {
  const t = useTranslations("Checkout");
  const tBooking = useTranslations("Booking");
  const tTanks = useTranslations("Tanks");
  const tLabels = useTranslations("Location.labels");
  const tUI = useTranslations("UI");
  const router = useRouter();
  const {
    data,
    draft,
    update,
    latestDraft,
    uploads,
    uploadsSettled,
    dropExpiredUploads,
    setNotice,
  } = useBooking();
  const [submitting, setSubmitting] = useState(false);
  // The booking just made: the button stays busy until N5 opens and clears
  // the draft. Next keeps this page alive, so a plain flag would stay set
  // for the next booking.
  const [bookedRequest, setBookedRequest] = useState<string | null>(null);
  const [error, setError] = useState<BookingError | null>(null);
  const busy = submitting || (bookedRequest !== null && draft?.requestId === bookedRequest);
  // The prices on screen when the request goes out: a refresh during a long
  // upload can bring new ones after the tap.
  const latestData = useRef(data);
  useEffect(() => {
    latestData.current = data;
  });

  const ready = draft !== null && detailsComplete(draft, data.days, data.maxTanks);
  useEffect(() => {
    if (draft && !ready && !busy) router.replace(routes.book);
  }, [draft, ready, busy, router]);
  if (!draft || !ready) return <BookingSkeleton />;

  const slot = findSlot(data.days, draft.serviceDate, draft.slotId);
  const total = draftTotal(draft.lines, data.savedTanks, data.prices);
  const uploading = uploads.some((u) => u.status === "preparing" || u.status === "uploading");
  const uploadFailed = uploads.some((u) => u.status === "failed");

  const confirm = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const files = await uploadsSettled();
      if (files.some((file) => file.status === "failed")) return;
      // A file too old to book (open in a tab for 2 days): forgotten here, so
      // Photos shows it gone and the customer adds it again.
      if (dropExpiredUploads() > 0) {
        setError("upload_missing");
        return;
      }
      // The booking as it is now: the customer may have changed it while
      // the uploads finished.
      const current = latestDraft();
      if (!detailsComplete(current, data.days, data.maxTanks)) return;
      // Kept with the draft, so sending again can't book twice.
      const requestId = current.requestId ?? crypto.randomUUID();
      if (!current.requestId) update((d) => ({ ...d, requestId }));

      const result = await createBooking({
        requestId,
        addressId: current.addressId,
        serviceDate: current.serviceDate ?? "",
        slotId: current.slotId ?? 0,
        items: orderItems(current.lines),
        note: current.note,
        media: files.map((file) => ({
          path: file.path,
          durationS: file.kind === "video" ? file.durationS : null,
        })),
        expectedTotal: draftTotal(
          current.lines,
          latestData.current.savedTanks,
          latestData.current.prices,
        ),
      });

      if (result.status === "booked") {
        // N5 forgets the draft once it opens (ForgetBooking).
        setBookedRequest(requestId);
        router.replace(routes.booked(result.orderId));
        return;
      }
      if (stepFor(result.error) === "details") {
        if (result.error === "slot_full" || result.error === "slot_unavailable") {
          update((d) => ({ ...d, slotId: null }));
        }
        setNotice(result.error);
        // Fresh places and tanks for step 1.
        router.refresh();
        router.push(routes.book);
        return;
      }
      // A price changed: reload the prices, so the total shown is the one
      // the next "أكّد الحجز" sends.
      if (result.error === "price_changed") router.refresh();
      setError(result.error);
    } catch {
      // The request never got an answer (offline). The same requestId is
      // sent again on retry, so a booking that did go through isn't doubled.
      setError("failed");
    } finally {
      setSubmitting(false);
    }
  };

  const day = draft.serviceDate ? serviceDayParts(draft.serviceDate) : null;
  const videos = uploads.filter((u) => u.kind === "video").length;
  const photos = uploads.length - videos;
  const onlyLine = draft.lines.length === 1 ? draft.lines[0] : undefined;
  const onlyTank = onlyLine && onlyLine.qty === 1 ? lineTank(onlyLine, data.savedTanks) : null;

  const summary: {
    key: string;
    icon: LucideIcon | ComponentType<SVGProps<SVGSVGElement>>;
    label: string;
    value: string;
    href: string;
  }[] = [
    {
      key: "service",
      icon: RoofTankIcon,
      label: t("service"),
      value: onlyTank
        ? t("serviceOne", {
            type: tTanks(`types.${onlyTank.type}`),
            size: tTanks(`sizes.${onlyTank.size}`),
          })
        : t("serviceMany", { count: tankCount(draft.lines) }),
      href: routes.book,
    },
    {
      key: "time",
      icon: Calendar,
      label: t("time"),
      value:
        day && slot
          ? t("when", {
              weekday: day.weekday,
              day: day.day,
              slot: tBooking("slot", slotParts(slot.startAt, slot.endAt)),
            })
          : "",
      href: routes.book,
    },
    {
      key: "address",
      icon: MapPin,
      label: t("address"),
      value: tBooking("addressLine", {
        label: tLabels(data.address.label),
        district: data.address.district,
      }),
      href: routes.book,
    },
    {
      key: "files",
      icon: Video,
      label: t("files"),
      value:
        uploads.length === 0
          ? t("filesNone")
          : [
              videos > 0 ? t("videos", { count: videos }) : null,
              photos > 0 ? t("photos", { count: photos }) : null,
            ]
              .filter(Boolean)
              .join(" · "),
      href: routes.bookPhotos,
    },
  ];

  const errorText =
    error === "outside_area"
      ? t("errors.outsideArea")
      : error === "upload_missing"
        ? t("errors.uploadMissing")
        : error === "price_changed"
          ? t("errors.priceChanged")
          : error
            ? t("errors.failed")
            : null;

  return (
    <Screen className="bg-bg">
      <BookingHeader title={t("title")} step={t("step")} current={3} backHref={routes.bookPhotos} />
      <div className="flex flex-1 flex-col gap-3 px-4 pt-1.5 pb-6">
        <dl
          aria-label={t("summaryLabel")}
          className="rounded-card border border-border bg-surface px-3.5 py-1"
        >
          {summary.map(({ key, icon: Icon, label, value, href }) => (
            <div key={key} className="flex min-h-12.5 items-center gap-2.5 border-b border-divider">
              <Icon aria-hidden className="size-5 shrink-0 text-teal" strokeWidth={2} />
              <dt className="w-17.5 shrink-0 text-13 text-muted">{label}</dt>
              <dd className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="text-14 font-extrabold">{value}</span>
                <Link
                  href={href}
                  className="flex min-h-11 shrink-0 items-center text-13 font-bold text-teal underline"
                >
                  {t("change")}
                  <span className="sr-only"> {label}</span>
                </Link>
              </dd>
            </div>
          ))}
        </dl>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-15 font-extrabold">{t("paymentLegend")}</legend>
          {payments.map((payment) => {
            const on = payment === "cash";
            return (
              <label
                key={payment}
                className={cn(
                  "flex min-h-14.5 items-center gap-3 rounded-input border-2 px-3.5 py-2",
                  "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-teal",
                  on ? "border-navy bg-selected" : "cursor-not-allowed border-border bg-surface",
                )}
              >
                <input
                  type="radio"
                  name="payment"
                  value={payment}
                  checked={on}
                  disabled={!on}
                  readOnly
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    "flex size-5.5 shrink-0 items-center justify-center rounded-full border-2",
                    on ? "border-navy" : "border-control-off",
                  )}
                >
                  {on && <span className="size-2.5 rounded-full bg-navy" />}
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-15 font-extrabold">{t(`payments.${payment}`)}</span>
                  <span className="text-12 text-muted">{t(`payments.${payment}Hint`)}</span>
                </span>
                {!on && (
                  <span className="rounded-10 bg-well px-2 py-0.5 text-12 font-bold text-muted">
                    {t("soon")}
                  </span>
                )}
              </label>
            );
          })}
        </fieldset>

        <div className="flex flex-col gap-1.5 rounded-card border border-border bg-surface px-3.5 py-3">
          {draft.lines.map((line) => {
            const tank = lineTank(line, data.savedTanks);
            if (!tank) return null;
            return (
              <div key={line.key} className="flex justify-between gap-3 text-14">
                <span className="text-muted">
                  {t("line", {
                    tank: `${tTanks(`types.${tank.type}`)} · ${tTanks(`sizes.${tank.size}`)}`,
                    qty: line.qty,
                  })}
                </span>
                <span className="font-bold">
                  {formatIQD(linePrice(line, data.savedTanks, data.prices))}
                </span>
              </div>
            );
          })}
          <div className="flex justify-between gap-3 text-14">
            <span className="text-muted">{t("certificate")}</span>
            <span className="font-bold text-ok-fg">{t("free")}</span>
          </div>
          <div className="flex justify-between gap-3 border-t border-dashed border-track pt-2 text-18 font-black">
            <span>{t("total")}</span>
            <span>{tUI("iqd", { amount: formatIQD(total) })}</span>
          </div>
        </div>

        <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
          {busy && uploading && <p className="text-14 text-muted">{t("waitingUploads")}</p>}
          {(uploadFailed || error === "upload_missing") && (
            <p className="text-14 font-bold text-danger">
              {uploadFailed ? t("uploadFailed") : errorText}{" "}
              <Link href={routes.bookPhotos} className="text-teal underline">
                {t("backToPhotos")}
              </Link>
            </p>
          )}
          {errorText && error !== "upload_missing" && (
            <p className="text-14 font-bold text-danger">{errorText}</p>
          )}
        </div>
      </div>
      <footer className="sticky bottom-0 z-10 flex flex-col gap-1.5 border-t border-border bg-surface px-5 pt-3 pb-safe-5.5">
        <Button loading={busy} disabled={uploadFailed} onClick={confirm}>
          {t("confirm")}
        </Button>
        <span className="text-center text-12 text-muted">{t("footer")}</span>
      </footer>
    </Screen>
  );
}
