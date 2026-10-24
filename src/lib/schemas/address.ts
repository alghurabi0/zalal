import { z } from "zod";

import type { Database } from "@/lib/database.types";

import { cleanText } from "./profile";

// Location (spec §5.4) and the address picker (N2). Limits match the
// checks on public.addresses.

export type AddressLabel = Database["public"]["Enums"]["address_label"];

export const addressLabels = ["home", "family", "work"] as const satisfies readonly AddressLabel[];

export const addressLabelSchema = z.enum(addressLabels);

export const addressInputSchema = z.object({
  label: addressLabelSchema,
  district: z
    .string()
    .transform(cleanText)
    .pipe(z.string().min(2, "too_short").max(60, "too_long")),
  landmark: z
    .string()
    .transform(cleanText)
    .pipe(z.string().min(2, "too_short").max(120, "too_long")),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export type AddressInput = z.input<typeof addressInputSchema>;

export const addressIdSchema = z.uuid();

/** Karbala city center (Imam Hussein shrine): the map's start when there's no GPS. */
export const KARBALA_CENTER = { lat: 32.6165, lng: 44.0324 } as const;
