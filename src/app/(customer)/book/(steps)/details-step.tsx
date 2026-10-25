"use client";

import { Check, MapPin, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { AddressPicker } from "@/app/(customer)/addresses/address-picker";
import { GroundTankIcon, RoofTankIcon } from "@/components/icons/tank-icons";
import { Screen } from "@/components/layout/screen";
import { Button } from "@/components/ui/button";
import { Chip, ChipGroup } from "@/components/ui/chip";
import { Stepper } from "@/components/ui/stepper";
import {
  DEFAULT_NEW_TANK,
  detailsComplete,
  draftTotal,
  isSavedLine,
  newLine,
  type NewLine,
  type SavedTank,
  tankCount,
} from "@/lib/booking/draft";
import type { BookingError } from "@/lib/booking/errors";
import { cn } from "@/lib/cn";
import { serviceDayParts, slotParts } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { routes } from "@/lib/routes";

import { BookingHeader } from "./booking-header";
import { useBooking } from "./booking-provider";
import { BookingSkeleton } from "./booking-skeleton";
import { TankLineSheet } from "./tank-line-sheet";

const typeIcons = { roof: RoofTankIcon, ground: GroundTankIcon } as const;

/**
 * Booking step 1 (Booking.dc.html, spec §5.9): the address with "تغيير"
 * (N2), the order's tank lines (saved tanks to pick, new tanks from the
 * "أضف خزان" sheet, each with its own quantity), the day and slot, and the
 * price.
 */
export function DetailsStep() {
  const t = useTranslations("Booking");
  const tUI = useTranslations("UI");
  const { data, draft, notice } = useBooking();
  if (!draft) return <BookingSkeleton />;

  const total = draftTotal(draft.lines, data.savedTanks, data.prices);
  const complete = detailsComplete(draft, data.days, data.maxTanks);

  return (
    <Screen className="bg-bg">
      <BookingHeader title={t("title")} step={t("step")} current={1} backHref={routes.home} />
      <div className="flex flex-1 flex-col gap-3.5 px-5 pt-1.5 pb-6">
        {notice && <Notice notice={notice} />}
        <AddressRow />
        <TankLines />
        <DayAndSlot />
      </div>
      <footer className="sticky bottom-0 z-10 flex items-center gap-3.5 border-t border-border bg-surface px-5 pt-3 pb-safe-5.5">
        <div className="flex flex-col">
          <span className="text-12 text-muted">{t("price")}</span>
          <span className="text-20 leading-snug font-black">
            {tUI("iqd", { amount: formatIQD(total) })}
          </span>
        </div>
        <Button href={routes.bookPhotos} size="footer" className="flex-1" disabled={!complete}>
          {t("next")}
        </Button>
      </footer>
    </Screen>
  );
}

function Notice({ notice }: { notice: BookingError }) {
  const t = useTranslations("Booking");
  const tCheckout = useTranslations("Checkout");
  const { data } = useBooking();
  const message =
    notice === "slot_full"
      ? t("errors.slotFull")
      : notice === "slot_unavailable"
        ? t("errors.slotUnavailable")
        : notice === "too_many_tanks"
          ? tCheckout("errors.tooManyTanks", { max: data.maxTanks })
          : t("errors.stale");
  return (
    <p
      role="alert"
      className="rounded-input bg-warn-bg px-3.5 py-2.5 text-14 font-bold text-warn-fg"
    >
      {message}
    </p>
  );
}

function AddressRow() {
  const t = useTranslations("Booking");
  const tLabels = useTranslations("Location.labels");
  const { data } = useBooking();
  const { address } = data;

  return (
    <div className="flex items-center gap-3 rounded-input border border-border bg-surface py-1.5 ps-3.5 pe-1">
      <MapPin aria-hidden className="size-5 shrink-0 text-teal" strokeWidth={2} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-12 text-muted">{t("address")}</span>
        <span className="truncate text-15 font-extrabold">
          {t("addressLine", { label: tLabels(address.label), district: address.district })}
        </span>
      </div>
      <AddressPicker
        addresses={data.addresses}
        mode="select"
        selectedId={address.id}
        returnTo={routes.book}
      >
        <Button variant="link" size="sm" className="px-2.5">
          {t("change")}
          <span className="sr-only"> {t("address")}</span>
        </Button>
      </AddressPicker>
    </div>
  );
}

function TankLines() {
  const t = useTranslations("Booking");
  const tTanks = useTranslations("Tanks");
  const headingId = useId();
  const { data, draft, update } = useBooking();
  if (!draft) return null;

  const room = data.maxTanks - tankCount(draft.lines);
  const newLines = draft.lines.filter((line): line is NewLine => !isSavedLine(line));
  const setQty = (key: string, qty: number) =>
    update((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, qty } : l)) }));

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-15 font-extrabold">
        {t("tanksLegend")}
      </h2>

      {data.savedTanks.map((tank) => (
        <SavedTankCard key={tank.id} tank={tank} room={room} setQty={setQty} />
      ))}

      {newLines.map((line) => {
        const Icon = typeIcons[line.type];
        const name = `${tTanks(`types.${line.type}`)} · ${tTanks(`sizes.${line.size}`)}`;
        return (
          <div key={line.key} className="rounded-button border-2 border-navy bg-selected">
            <div className="flex items-center gap-3 p-3">
              <Icon className="size-7.5 shrink-0 text-teal" />
              <span className="flex min-w-0 flex-col">
                <span className="text-15 font-extrabold">{tTanks(`types.${line.type}`)}</span>
                <span className="text-12 text-muted">{tTanks(`sizes.${line.size}`)}</span>
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border py-1.5 ps-1 pe-3">
              <div className="flex">
                <TankLineSheet
                  mode="edit"
                  initial={line}
                  maxQty={line.qty + room}
                  onSave={(values) =>
                    update((d) => ({
                      ...d,
                      lines: d.lines.map((l) => (l.key === line.key ? { ...l, ...values } : l)),
                    }))
                  }
                >
                  <Button
                    variant="link"
                    size="sm"
                    className="px-2"
                    aria-label={t("editLine", { name })}
                  >
                    {t("edit")}
                  </Button>
                </TankLineSheet>
                <Button
                  variant="link"
                  size="sm"
                  className="px-2 text-danger"
                  aria-label={t("removeLine", { name })}
                  onClick={() =>
                    update((d) => ({ ...d, lines: d.lines.filter((l) => l.key !== line.key) }))
                  }
                >
                  {t("remove")}
                </Button>
              </div>
              <Stepper
                label={t("qtyLabel", { name })}
                value={line.qty}
                max={line.qty + room}
                onValueChange={(qty) => setQty(line.key, qty)}
              />
            </div>
          </div>
        );
      })}

      {draft.lines.length === 0 && <p className="text-14 text-muted">{t("noLines")}</p>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {room > 0 ? (
          <TankLineSheet
            mode="add"
            initial={{ ...DEFAULT_NEW_TANK, qty: 1 }}
            maxQty={room}
            onSave={(values) =>
              update((d) => ({ ...d, lines: [...d.lines, newLine(values, crypto.randomUUID())] }))
            }
          >
            <Button variant="secondary" size="sm">
              <Plus aria-hidden className="size-4.5 text-teal" strokeWidth={2.4} />
              {t("addTank")}
            </Button>
          </TankLineSheet>
        ) : (
          <p className="text-13 text-muted">{t("tankLimit", { max: data.maxTanks })}</p>
        )}
      </div>
    </section>
  );
}

function SavedTankCard({
  tank,
  room,
  setQty,
}: {
  tank: SavedTank;
  room: number;
  setQty: (key: string, qty: number) => void;
}) {
  const t = useTranslations("Booking");
  const tTanks = useTranslations("Tanks");
  const { draft, update } = useBooking();
  const line = draft?.lines.find((l) => isSavedLine(l) && l.tankId === tank.id);
  const Icon = typeIcons[tank.type];
  const typeName = tTanks(`types.${tank.type}`);
  const sizeName = tTanks(`sizes.${tank.size}`);
  const name = tank.nickname ?? typeName;

  return (
    <div
      className={cn(
        "rounded-button border-2",
        line ? "border-navy bg-selected" : "border-border bg-surface",
      )}
    >
      <button
        type="button"
        aria-pressed={!!line}
        aria-label={t("selectTank", { name: `${name} · ${sizeName}` })}
        disabled={!line && room <= 0}
        onClick={() =>
          update((d) => ({
            ...d,
            lines: line
              ? d.lines.filter((l) => l.key !== line.key)
              : [...d.lines, { key: crypto.randomUUID(), tankId: tank.id, qty: 1 }],
          }))
        }
        className="flex min-h-11 w-full items-center gap-3 rounded-button p-3 text-start disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon className="size-7.5 shrink-0 text-teal" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-15 font-extrabold">{name}</span>
          <span className="text-12 text-muted">
            {tank.nickname ? t("savedTank", { name: typeName, size: sizeName }) : sizeName}
          </span>
        </span>
        <span
          aria-hidden
          className={cn(
            "flex size-5.5 shrink-0 items-center justify-center rounded-full border-2",
            line ? "border-navy bg-navy text-white" : "border-control-off",
          )}
        >
          {line && <Check className="size-3.5" strokeWidth={3} />}
        </span>
      </button>
      {line && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5">
          <span className="text-14 font-bold">{t("count")}</span>
          <Stepper
            label={t("qtyLabel", { name })}
            value={line.qty}
            max={line.qty + room}
            onValueChange={(qty) => setQty(line.key, qty)}
          />
        </div>
      )}
    </div>
  );
}

function DayAndSlot() {
  const t = useTranslations("Booking");
  const { data, draft, update } = useBooking();
  if (!draft) return null;
  const day = data.days.find((d) => d.date === draft.serviceDate) ?? null;

  if (data.days.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-15 font-extrabold">{t("dateLegend")}</h2>
        <p className="text-14 text-muted">{t("noDays")}</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ChipGroup
        legend={t("dateLegend")}
        // A fieldset is as wide as its content unless told otherwise, so the
        // scrolling row of days would widen the page.
        className="min-w-0"
        bodyClassName="-mx-5 flex-nowrap overflow-x-auto px-5 pt-0.5 pb-1"
      >
        {data.days.map((option) => {
          const { weekday, day: dayOfMonth } = serviceDayParts(option.date);
          return (
            <Chip
              key={option.date}
              type="radio"
              name="service-day"
              value={option.date}
              checked={draft.serviceDate === option.date}
              disabled={option.full}
              onChange={() => update((d) => ({ ...d, serviceDate: option.date, slotId: null }))}
              className="min-h-15 w-20 shrink-0 gap-0 px-1"
            >
              <span className="text-12">{weekday}</span>
              <span className="text-18 leading-tight font-black">{dayOfMonth}</span>
              {option.full && <span className="text-11">{t("dayFull")}</span>}
            </Chip>
          );
        })}
      </ChipGroup>

      {day && (
        <ChipGroup
          legend={t("slotLegend")}
          legendClassName="sr-only"
          bodyClassName="grid grid-cols-3 gap-2"
        >
          {day.slots.map((slot) => (
            <Chip
              key={slot.slotId}
              type="radio"
              name="slot"
              value={slot.slotId}
              checked={draft.slotId === slot.slotId}
              disabled={!slot.bookable}
              onChange={() => update((d) => ({ ...d, slotId: slot.slotId }))}
              className="gap-0 leading-snug"
            >
              <span>{t("slot", slotParts(slot.startAt, slot.endAt))}</span>
              <span className="text-11 font-semibold">
                {slot.bookable ? t("remaining", { count: slot.remaining }) : t("slotFull")}
              </span>
            </Chip>
          ))}
        </ChipGroup>
      )}
    </div>
  );
}
