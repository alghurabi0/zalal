"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import { LocateFixed, MapPinOff } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";

import { MapPlaceholder } from "@/components/illustrations/map-placeholder";
import { SystemState } from "@/components/layout/system-state";
import { CenterPin } from "@/components/location/center-pin";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Chip, ChipGroup } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SheetPanel } from "@/components/ui/sheet-panel";
import { publicEnv } from "@/lib/env";
import { type AddressLabel, addressLabels, KARBALA_CENTER } from "@/lib/schemas/address";

import { saveAddress, type SaveAddressState } from "./actions";
import { GoogleMapLayer, type LatLng, PlaceSearch } from "./google-map";

export type EditableAddress = {
  id: string;
  label: AddressLabel;
  district: string;
  landmark: string;
  lat: number;
  lng: number;
};

type LocationEditorProps = {
  /** Set when editing; a new address otherwise. */
  address: EditableAddress | null;
  /** Labels the user's other addresses already use (one each, spec §5.4). */
  usedLabels: AddressLabel[];
  /** Onboarding: "بعدين" (to `laterHref`) replaces the back button. */
  onboarding: boolean;
  backHref: string;
  /** Where saving (or "بعدين") goes. */
  next: string;
  /** settings.company_phone for N16's out-of-area screen, null while unset. */
  supportPhone?: string | null;
};

/** Location (Location.dc.html, spec §5.4): pin on the map, district, landmark, label. */
export function LocationEditor(props: LocationEditorProps) {
  const apiKey = publicEnv().NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return <Editor {...props} withMap={false} />;
  return (
    <APIProvider apiKey={apiKey} language="ar" region="IQ">
      <Editor {...props} withMap />
    </APIProvider>
  );
}

function Editor({
  address,
  usedLabels,
  onboarding,
  backHref,
  next,
  withMap,
  supportPhone = null,
}: LocationEditorProps & { withMap: boolean }) {
  const t = useTranslations("Location");
  const tSystem = useTranslations("System");
  const [state, action, pending] = useActionState<SaveAddressState, FormData>(saveAddress, {
    error: null,
  });
  // N16 out of area: a new user's first pin outside the area gets the full
  // screen (settled Oct 28, 2026); later addresses keep the inline message.
  // "غيّر الموقع" closes it for this answer, and the next refusal opens it again.
  const [closedFor, setClosedFor] = useState<SaveAddressState | null>(null);
  const outOfArea = onboarding && state.error === "outside_area" && closedFor !== state;

  const initial = address ? { lat: address.lat, lng: address.lng } : KARBALA_CENTER;
  const [center, setCenter] = useState<LatLng>(initial);
  const panToRef = useRef<((position: LatLng) => void) | null>(null);
  // A position asked for before the map is ready (a cached GPS fix comes
  // back almost at once): the map centers on it as soon as it exists.
  const pendingPanRef = useRef<LatLng | null>(null);
  const moveTo = useCallback((position: LatLng) => {
    // With Google Maps the map pans and reports its new center when idle.
    setCenter(position);
    if (panToRef.current) panToRef.current(position);
    else pendingPanRef.current = position;
  }, []);

  const [locating, setLocating] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  /** Asks the browser for the position; false when there's no geolocation. */
  const requestPosition = useCallback(() => {
    if (!("geolocation" in navigator)) return false;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setLocationDenied(false);
        moveTo({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => {
        // Denied or unavailable: the map stays where it is (Karbala center
        // for a new address) and search still works (spec §5.4).
        setLocating(false);
        setLocationDenied(true);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
    return true;
  }, [moveTo]);

  const locate = () => {
    setLocating(true);
    if (!requestPosition()) {
      setLocating(false);
      setLocationDenied(true);
    }
  };

  // A new address starts from the user's position when they allow it.
  useEffect(() => {
    if (!address) requestPosition();
  }, [address, requestPosition]);

  const freeLabels = addressLabels.filter((label) => !usedLabels.includes(label));
  const [label, setLabel] = useState<AddressLabel | undefined>(address?.label ?? freeLabels[0]);

  const fieldError = (field: "district" | "landmark") => {
    const found = state.fields?.find((f) => f.startsWith(field));
    if (!found) return undefined;
    const keys = {
      district_short: "districtShort",
      district_long: "districtLong",
      landmark_short: "landmarkShort",
      landmark_long: "landmarkLong",
    } as const;
    return t(`errors.${keys[found]}`);
  };
  const formError =
    state.error === "outside_area"
      ? t("errors.outsideArea")
      : state.error === "label_taken"
        ? t("errors.labelTaken")
        : state.error === "failed"
          ? t("errors.failed")
          : null;

  return (
    <div className="mx-auto flex h-dvh w-full max-w-phone flex-col overflow-hidden bg-map-bg">
      {outOfArea && (
        <div
          role="alertdialog"
          aria-modal
          aria-labelledby="out-of-area-title"
          className="fixed inset-0 z-50"
        >
          <SystemState
            icon={MapPinOff}
            title={tSystem("outOfAreaTitle")}
            titleId="out-of-area-title"
            body={tSystem("outOfAreaBody")}
            phone={supportPhone}
            callLabel={tSystem("call")}
            action={
              <Button autoFocus onClick={() => setClosedFor(state)}>
                {tSystem("changePin")}
              </Button>
            }
          />
        </div>
      )}
      <div className="relative min-h-50 flex-1">
        <MapPlaceholder className="absolute inset-0" />
        {withMap && (
          <GoogleMapLayer
            initial={initial}
            onIdle={setCenter}
            panToRef={panToRef}
            pendingPanRef={pendingPanRef}
          />
        )}
        <CenterPin />

        <div className="absolute inset-x-5 top-5 z-10 flex items-start gap-3">
          {onboarding ? (
            <Link
              href={next}
              className="flex h-11 shrink-0 items-center rounded-full bg-surface px-4 text-14 font-bold text-navy shadow-float"
            >
              {t("later")}
            </Link>
          ) : (
            <BackButton href={backHref} variant="floating" />
          )}
          {withMap && <PlaceSearch onPick={moveTo} />}
        </div>

        <div className="absolute inset-x-5 bottom-10 z-10 flex flex-col items-end gap-2">
          {locationDenied && (
            <p
              role="status"
              className="rounded-chip bg-surface/95 px-3 py-2 text-13 font-bold text-body-2 shadow-float"
            >
              {withMap ? t("locationDenied") : t("locationDeniedNoMap")}
            </p>
          )}
          <button
            type="button"
            onClick={locate}
            disabled={locating}
            className="flex h-11 items-center gap-1.5 rounded-full bg-surface px-3.5 text-14 font-bold text-navy shadow-float disabled:opacity-70"
          >
            <LocateFixed aria-hidden className="size-4.5 text-teal" strokeWidth={2} />
            {locating ? t("locating") : t("myLocation")}
          </button>
        </div>
      </div>

      <SheetPanel
        title={address ? t("editTitle") : t("title")}
        titleAs="h1"
        description={withMap ? t("subtitle") : t("subtitleNoMap")}
        className="relative z-10 -mt-6"
      >
        <form action={action} className="flex flex-col gap-3">
          {address && <input type="hidden" name="id" value={address.id} />}
          <input type="hidden" name="lat" value={center.lat} />
          <input type="hidden" name="lng" value={center.lng} />
          <input type="hidden" name="next" value={next} />

          <Field label={t("district")} variant="compact" error={fieldError("district")}>
            {(control) => (
              <Input
                {...control}
                variant="compact"
                name="district"
                required
                minLength={2}
                maxLength={60}
                defaultValue={address?.district}
                placeholder={t("districtPlaceholder")}
              />
            )}
          </Field>
          <Field label={t("landmark")} variant="compact" error={fieldError("landmark")}>
            {(control) => (
              <Input
                {...control}
                variant="compact"
                name="landmark"
                required
                minLength={2}
                maxLength={120}
                defaultValue={address?.landmark}
                placeholder={t("landmarkPlaceholder")}
              />
            )}
          </Field>
          <ChipGroup
            legend={<span className="sr-only">{t("labelLegend")}</span>}
            legendClassName="mb-0"
          >
            {addressLabels.map((value) => {
              const taken = usedLabels.includes(value);
              return (
                <Chip
                  key={value}
                  type="radio"
                  variant="pill"
                  name="label"
                  value={value}
                  checked={label === value}
                  onChange={() => setLabel(value)}
                  disabled={taken}
                  required
                >
                  {t(`labels.${value}`)}
                  {taken && <span className="sr-only"> ({t("labelTaken")})</span>}
                </Chip>
              );
            })}
          </ChipGroup>

          <p aria-live="polite" className={formError ? "text-14 font-bold text-danger" : "sr-only"}>
            {formError}
          </p>
          <Button type="submit" loading={pending} disabled={!label}>
            {t("save")}
          </Button>
        </form>
      </SheetPanel>
    </div>
  );
}
