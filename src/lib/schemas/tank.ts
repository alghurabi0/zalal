import { z } from "zod";

import type { Database } from "@/lib/database.types";

import { cleanText } from "./profile";

// My tanks (N3). Limits match the checks on public.tanks.

export type TankType = Database["public"]["Enums"]["tank_type"];
export type TankSize = Database["public"]["Enums"]["tank_size"];

export const tankTypes = ["roof", "ground"] as const satisfies readonly TankType[];
export const tankSizes = ["s", "m", "l"] as const satisfies readonly TankSize[];

export const tankInputSchema = z.object({
  addressId: z.uuid(),
  type: z.enum(tankTypes),
  size: z.enum(tankSizes),
  // Optional: an empty field saves as no nickname.
  nickname: z
    .string()
    .optional()
    .transform((value) => (value ? cleanText(value) : ""))
    .pipe(z.string().max(30, "too_long"))
    .transform((value) => (value === "" ? null : value)),
});

export type TankInput = z.input<typeof tankInputSchema>;
