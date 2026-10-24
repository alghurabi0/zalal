// TypeScript 6 no longer loads every @types package by itself.
/// <reference types="google.maps" />
"use client";

import { Map, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { type RefObject, useEffect, useId, useRef, useState } from "react";

import { KARBALA_CENTER } from "@/lib/schemas/address";

// Google Maps parts of Location (spec §5.4, §9.3). Rendered only inside
// <APIProvider>, i.e. when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set.

export type LatLng = { lat: number; lng: number };

/** The map under the fixed pin. Reports its center whenever it stops moving. */
export function GoogleMapLayer({
  initial,
  onIdle,
  panToRef,
}: {
  initial: LatLng;
  onIdle: (center: LatLng) => void;
  /** Filled with a function that pans the map, for search and "موقعي الحالي". */
  panToRef: RefObject<((position: LatLng) => void) | null>;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    panToRef.current = (position) => map.panTo(position);
    return () => {
      panToRef.current = null;
    };
  }, [map, panToRef]);

  return (
    <Map
      className="absolute inset-0"
      defaultCenter={initial}
      defaultZoom={17}
      gestureHandling="greedy"
      disableDefaultUI
      clickableIcons={false}
      onIdle={(event) => {
        const center = event.map.getCenter();
        if (center) onIdle(center.toJSON());
      }}
    />
  );
}

type Suggestion = {
  id: string;
  main: string;
  secondary: string;
  prediction: google.maps.places.PlacePrediction;
};

/**
 * "ابحث عن حي أو شارع": Places Autocomplete (New), limited to Iraq and
 * biased to Karbala. Picking a result pans the map to it.
 */
export function PlaceSearch({ onPick }: { onPick: (position: LatLng) => void }) {
  const t = useTranslations("Location");
  const places = useMapsLibrary("places");
  const listId = useId();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searched, setSearched] = useState(false);
  // One billing session per search, ended by picking a place.
  const session = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  useEffect(() => {
    const input = query.trim();
    if (!places || input.length < 2) return;
    let stale = false;
    const timer = setTimeout(async () => {
      session.current ??= new places.AutocompleteSessionToken();
      try {
        const { suggestions: found } =
          await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input,
            sessionToken: session.current,
            includedRegionCodes: ["iq"],
            locationBias: { center: KARBALA_CENTER, radius: 30_000 },
            language: "ar",
            region: "iq",
          });
        if (stale) return;
        setSuggestions(
          found.flatMap((s) =>
            s.placePrediction
              ? [
                  {
                    id: s.placePrediction.placeId,
                    main: s.placePrediction.mainText?.text ?? s.placePrediction.text.text,
                    secondary: s.placePrediction.secondaryText?.text ?? "",
                    prediction: s.placePrediction,
                  },
                ]
              : [],
          ),
        );
        setSearched(true);
        setOpen(true);
      } catch {
        if (!stale) setSuggestions([]);
      }
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [places, query]);

  const pick = async (suggestion: Suggestion) => {
    setOpen(false);
    setQuery(suggestion.main);
    const place = suggestion.prediction.toPlace();
    session.current = null;
    try {
      await place.fetchFields({ fields: ["location"] });
      if (place.location) onPick(place.location.toJSON());
    } catch {
      // The pin stays where it is; the user can move the map by hand.
    }
  };

  const showList = open && query.trim().length >= 2 && searched;

  return (
    <div className="relative min-w-0 flex-1">
      <div className="flex h-11 items-center gap-2 rounded-full bg-surface px-3.5 shadow-float focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-teal">
        <Search aria-hidden className="size-4.5 shrink-0 text-muted" strokeWidth={2} />
        <label htmlFor={inputId} className="sr-only">
          {t("searchLabel")}
        </label>
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          enterKeyHint="search"
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          className="min-w-0 flex-1 bg-transparent text-15 text-navy outline-none placeholder:text-muted"
        />
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("searchLabel")}
          className="absolute inset-x-0 top-13 max-h-72 overflow-y-auto rounded-card bg-surface py-1 shadow-float"
        >
          {suggestions.length === 0 ? (
            <li className="px-4 py-3 text-14 text-muted">{t("noResults")}</li>
          ) : (
            suggestions.map((suggestion) => (
              <li key={suggestion.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => void pick(suggestion)}
                  className="flex min-h-11 w-full flex-col items-start px-4 py-2 text-start"
                >
                  <span className="text-15 font-bold">{suggestion.main}</span>
                  {suggestion.secondary && (
                    <span className="text-13 text-muted">{suggestion.secondary}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
