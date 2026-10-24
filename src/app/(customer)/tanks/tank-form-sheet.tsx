"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useActionState, useState } from "react";

import { GroundTankIcon, RoofTankIcon } from "@/components/icons/tank-icons";
import { Button } from "@/components/ui/button";
import { Chip, ChipGroup } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import type { AddressLabel } from "@/lib/schemas/address";
import { type TankSize, tankSizes, type TankType, tankTypes } from "@/lib/schemas/tank";

import { saveTank, type SaveTankState } from "./actions";

export type TankAddress = { id: string; label: AddressLabel; district: string };
export type EditableTank = {
  id: string;
  addressId: string;
  type: TankType;
  size: TankSize;
  nickname: string | null;
};

const typeIcons = { roof: RoofTankIcon, ground: GroundTankIcon } as const;

type TankFormSheetProps = {
  addresses: TankAddress[];
  /** Set when editing. */
  tank?: EditableTank;
  /** The address a new tank goes on (the section it was opened from). */
  addressId: string;
  children: ReactNode;
};

/** Add or edit a tank (N3): type and size tiles from Booking.dc.html, plus a nickname. */
export function TankFormSheet({ addresses, tank, addressId, children }: TankFormSheetProps) {
  const t = useTranslations("Tanks");
  const tLabels = useTranslations("Location.labels");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // A new key per opening resets the form and its last result.
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
      <SheetContent title={tank ? t("editTitle") : t("addTitle")}>
        <TankForm
          key={session}
          addresses={addresses}
          tank={tank}
          addressId={addressId}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
          tLabel={(label) => tLabels(label)}
        />
      </SheetContent>
    </Sheet>
  );
}

function TankForm({
  addresses,
  tank,
  addressId,
  onSaved,
  tLabel,
}: Omit<TankFormSheetProps, "children"> & {
  onSaved: () => void;
  tLabel: (label: AddressLabel) => string;
}) {
  const t = useTranslations("Tanks");
  const [state, action, pending] = useActionState(
    async (prev: SaveTankState, form: FormData): Promise<SaveTankState> => {
      const result = await saveTank(prev, form);
      if (result.status === "saved") onSaved();
      return result;
    },
    { status: "idle" },
  );
  const error = state.status === "error" ? state.error : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      {tank && <input type="hidden" name="id" value={tank.id} />}

      {/* A tank stays on its address, so the choice is only for new ones. */}
      {!tank && addresses.length > 1 ? (
        <ChipGroup legend={t("addressLegend")} legendClassName="text-14 font-bold">
          {addresses.map((address) => (
            <Chip
              key={address.id}
              type="radio"
              variant="pill"
              name="addressId"
              value={address.id}
              defaultChecked={address.id === addressId}
              required
            >
              {tLabel(address.label)}
            </Chip>
          ))}
        </ChipGroup>
      ) : (
        <input type="hidden" name="addressId" value={tank?.addressId ?? addressId} />
      )}

      <ChipGroup
        legend={t("typeLegend")}
        legendClassName="text-14 font-bold"
        bodyClassName="grid grid-cols-2 gap-2.5"
      >
        {tankTypes.map((type) => {
          const Icon = typeIcons[type];
          return (
            <Chip
              key={type}
              type="radio"
              name="type"
              value={type}
              defaultChecked={(tank?.type ?? "roof") === type}
              required
              className="items-start gap-0.5 rounded-card px-3.5 py-3 text-start"
            >
              <Icon className="mb-1 size-7 text-teal" />
              <span className="text-16 font-extrabold text-navy">{t(`types.${type}`)}</span>
              <span className="text-12 font-normal text-muted">{t(`typeHints.${type}`)}</span>
            </Chip>
          );
        })}
      </ChipGroup>

      <ChipGroup
        legend={t("sizeLegend")}
        legendClassName="text-14 font-bold"
        bodyClassName="grid grid-cols-3 gap-2"
      >
        {tankSizes.map((size) => (
          <Chip
            key={size}
            type="radio"
            name="size"
            value={size}
            defaultChecked={(tank?.size ?? "m") === size}
            required
            className="h-11.5 rounded-input text-13"
          >
            {t(`sizes.${size}`)}
          </Chip>
        ))}
      </ChipGroup>

      <Field
        label={t("nickname")}
        variant="compact"
        error={error === "nickname_long" ? t("errors.nicknameLong") : undefined}
      >
        {(control) => (
          <Input
            {...control}
            variant="compact"
            name="nickname"
            maxLength={30}
            defaultValue={tank?.nickname ?? ""}
            placeholder={t("nicknamePlaceholder")}
          />
        )}
      </Field>

      <p
        aria-live="polite"
        className={error === "failed" ? "text-14 font-bold text-danger" : "sr-only"}
      >
        {error === "failed" ? t("errors.failed") : null}
      </p>
      <Button type="submit" loading={pending}>
        {t("save")}
      </Button>
    </form>
  );
}
