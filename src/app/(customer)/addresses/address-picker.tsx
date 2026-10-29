"use client";

import { CircleCheck, MapPin, MapPinPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { routes, withNext } from "@/lib/routes";
import type { AddressLabel } from "@/lib/schemas/address";

import {
  type AddressActionState,
  deleteAddress,
  makeDefaultAddress,
  selectHomeAddress,
} from "./actions";

export type AddressSummary = {
  id: string;
  label: AddressLabel;
  district: string;
  landmark: string;
  isDefault: boolean;
};

/** Each label once per user, so three addresses is the most. */
const MAX_ADDRESSES = 3;

type AddressPickerProps = {
  addresses: AddressSummary[];
  /** select: Home's header, tapping an address shows it on Home. manage: Profile. */
  mode: "select" | "manage";
  /** The address Home shows (select mode). */
  selectedId?: string | null;
  /** Where Location returns after adding or editing. */
  returnTo: string;
  /** The button that opens the sheet. */
  children: ReactNode;
};

/**
 * Address list / picker (N2): label, district and landmark; select, edit,
 * delete, mark default and add (which opens Location).
 */
export function AddressPicker({
  addresses,
  mode,
  selectedId,
  returnTo,
  children,
}: AddressPickerProps) {
  const t = useTranslations("Addresses");
  const tLabels = useTranslations("Location.labels");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<AddressActionState>, after?: () => void) => {
    setFailed(false);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setFailed(true);
        return;
      }
      setConfirming(null);
      after?.();
      router.refresh();
    });
  };

  const addHref = withNext(routes.newAddress, returnTo);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setConfirming(null);
        setFailed(false);
      }}
    >
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent title={mode === "select" ? t("pickTitle") : t("title")} busy={pending}>
        {addresses.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            className="px-2 py-4"
            action={
              <Button href={addHref} onClick={() => setOpen(false)} size="md" className="w-full">
                {t("add")}
              </Button>
            }
          />
        ) : (
          <>
            <ul className="flex flex-col gap-2.5">
              {addresses.map((address) => {
                const label = tLabels(address.label);
                const selected = mode === "select" && address.id === selectedId;
                const summary = (
                  <>
                    <MapPin
                      aria-hidden
                      className="mt-1 size-5 shrink-0 text-teal"
                      strokeWidth={2}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-2 text-16 font-extrabold">
                        {label}
                        {address.isDefault && (
                          <span className="rounded-10 bg-selected px-2 text-12 font-bold text-teal">
                            {t("default")}
                          </span>
                        )}
                      </span>
                      <span className="text-13 text-muted">
                        {address.district} · {address.landmark}
                      </span>
                    </span>
                    {selected && (
                      <CircleCheck
                        aria-hidden
                        className="size-5.5 shrink-0 text-navy"
                        strokeWidth={2.2}
                      />
                    )}
                  </>
                );

                return (
                  <li key={address.id}>
                    <Card
                      className={cn(
                        "flex flex-col gap-1 px-3.5 pt-3 pb-1",
                        selected && "border-navy bg-selected",
                      )}
                    >
                      {mode === "select" ? (
                        <button
                          type="button"
                          aria-pressed={selected}
                          aria-label={t("select", { label })}
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => selectHomeAddress(address.id),
                              () => setOpen(false),
                            )
                          }
                          className="flex min-h-11 items-start gap-3 text-start"
                        >
                          {summary}
                        </button>
                      ) : (
                        <div className="flex items-start gap-3">{summary}</div>
                      )}

                      {confirming === address.id ? (
                        <div className="flex flex-wrap items-center gap-x-2 border-t border-divider pt-1">
                          <span className="text-13 font-bold text-danger">
                            {t("confirmDelete", { label })}
                          </span>
                          <Button
                            variant="link"
                            size="sm"
                            className="px-2 text-danger"
                            loading={pending}
                            onClick={() => run(() => deleteAddress(address.id))}
                          >
                            {t("confirmDeleteYes")}
                          </Button>
                          <Button
                            variant="link"
                            size="sm"
                            className="px-2 text-muted"
                            disabled={pending}
                            onClick={() => setConfirming(null)}
                          >
                            {t("confirmDeleteNo")}
                          </Button>
                        </div>
                      ) : (
                        <div className="-ms-2 flex flex-wrap items-center border-t border-divider">
                          <Button
                            variant="link"
                            size="sm"
                            className="px-2"
                            href={withNext(routes.editAddress(address.id), returnTo)}
                            // Next keeps this page alive while Location is
                            // open; leave it with the sheet closed.
                            onClick={() => setOpen(false)}
                            aria-label={`${t("edit")} ${label}`}
                          >
                            {t("edit")}
                          </Button>
                          {!address.isDefault && (
                            <Button
                              variant="link"
                              size="sm"
                              className="px-2"
                              disabled={pending}
                              onClick={() => run(() => makeDefaultAddress(address.id))}
                              aria-label={`${t("makeDefault")}: ${label}`}
                            >
                              {t("makeDefault")}
                            </Button>
                          )}
                          <Button
                            variant="link"
                            size="sm"
                            className="px-2 text-danger"
                            disabled={pending}
                            onClick={() => setConfirming(address.id)}
                            aria-label={`${t("delete")} ${label}`}
                          >
                            {t("delete")}
                          </Button>
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
            <p aria-live="polite" className={failed ? "text-14 font-bold text-danger" : "sr-only"}>
              {failed ? t("errors.failed") : null}
            </p>
            {addresses.length < MAX_ADDRESSES && (
              <Button href={addHref} onClick={() => setOpen(false)} variant="secondary" size="md">
                <MapPinPlus aria-hidden className="size-5 text-teal" strokeWidth={2} />
                {t("add")}
              </Button>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
