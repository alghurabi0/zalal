"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { GroundTankIcon, RoofTankIcon } from "@/components/icons/tank-icons";
import { Button } from "@/components/ui/button";
import { Chip, ChipGroup } from "@/components/ui/chip";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Stepper } from "@/components/ui/stepper";
import { type TankSize, tankSizes, type TankType, tankTypes } from "@/lib/schemas/tank";

const typeIcons = { roof: RoofTankIcon, ground: GroundTankIcon } as const;

export type TankLineValues = { type: TankType; size: TankSize; qty: number };

type TankLineSheetProps = {
  mode: "add" | "edit";
  initial: TankLineValues;
  /** The most this line may hold: the tank limit minus the other lines. */
  maxQty: number;
  onSave: (values: TankLineValues) => void;
  /** The button that opens the sheet. */
  children: ReactNode;
};

/**
 * "أضف خزان" (spec §5.9): Booking.dc.html's type tiles, size chips and count
 * stepper, now a form for one tank line. Also edits a new-tank line.
 */
export function TankLineSheet({ mode, initial, maxQty, onSave, children }: TankLineSheetProps) {
  const t = useTranslations("Booking");
  const [open, setOpen] = useState(false);
  // A new key per opening starts the form from `initial` again.
  const [session, setSession] = useState(0);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSession((n) => n + 1);
      }}
    >
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent title={mode === "add" ? t("addTitle") : t("editTitle")}>
        <TankLineForm
          key={session}
          mode={mode}
          initial={initial}
          maxQty={maxQty}
          onSave={(values) => {
            onSave(values);
            setOpen(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function TankLineForm({ mode, initial, maxQty, onSave }: Omit<TankLineSheetProps, "children">) {
  const t = useTranslations("Booking");
  const tTanks = useTranslations("Tanks");
  const [values, setValues] = useState(() => ({
    ...initial,
    qty: Math.min(initial.qty, Math.max(maxQty, 1)),
  }));

  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(values);
      }}
    >
      <ChipGroup legend={t("typeLegend")} bodyClassName="grid grid-cols-2 gap-2">
        {tankTypes.map((type) => {
          const Icon = typeIcons[type];
          return (
            <Chip
              key={type}
              type="radio"
              name="type"
              value={type}
              checked={values.type === type}
              onChange={() => setValues((v) => ({ ...v, type }))}
              className="items-start gap-0.5 rounded-button p-3 text-start"
            >
              <Icon className="size-7.5 text-teal" />
              <span className="text-15 font-extrabold text-navy">{tTanks(`types.${type}`)}</span>
              <span className="text-12 font-normal text-muted">{tTanks(`typeHints.${type}`)}</span>
            </Chip>
          );
        })}
      </ChipGroup>

      <ChipGroup legend={t("sizeLegend")} bodyClassName="grid grid-cols-3 gap-2">
        {tankSizes.map((size) => (
          <Chip
            key={size}
            type="radio"
            name="size"
            value={size}
            checked={values.size === size}
            onChange={() => setValues((v) => ({ ...v, size }))}
          >
            {tTanks(`sizes.${size}`)}
          </Chip>
        ))}
      </ChipGroup>

      <div className="flex items-center justify-between rounded-input border border-border bg-surface px-3 py-2">
        <span className="text-15 font-extrabold">{t("count")}</span>
        <Stepper
          label={t("count")}
          value={values.qty}
          max={Math.max(maxQty, 1)}
          onValueChange={(qty) => setValues((v) => ({ ...v, qty }))}
        />
      </div>

      <Button type="submit" size="footer">
        {mode === "add" ? t("addSave") : t("editSave")}
      </Button>
    </form>
  );
}
