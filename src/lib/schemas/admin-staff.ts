import { z } from "zod";

import { phoneInputSchema } from "@/lib/phone";

import { cleanText, fullNameSchema } from "./profile";

// What the A10 Crews and A14 Admins forms send to their Server Actions (spec
// §8.2). The admin RPCs validate everything again.

/** crews.name: 2–30 characters after trimming ("فريق 1"). */
export const CREW_NAME_MAX = 30;
export const crewNameSchema = z
  .string()
  .transform(cleanText)
  .pipe(z.string().min(2, "too_short").max(CREW_NAME_MAX, "too_long"));

export const createCrewSchema = z.object({ phone: phoneInputSchema, name: crewNameSchema });
export type CreateCrewInput = z.input<typeof createCrewSchema>;

export const updateCrewSchema = z.object({
  id: z.uuid(),
  name: crewNameSchema,
  active: z.boolean(),
});
export type UpdateCrewInput = z.input<typeof updateCrewSchema>;

export const setCrewPhoneSchema = z.object({ id: z.uuid(), phone: phoneInputSchema });
export type SetCrewPhoneInput = z.input<typeof setCrewPhoneSchema>;

/** The name is kept only for an account that has none yet. */
export const addAdminSchema = z.object({ phone: phoneInputSchema, name: fullNameSchema });
export type AddAdminInput = z.input<typeof addAdminSchema>;

export const removeAdminSchema = z.object({ userId: z.uuid() });
export type RemoveAdminInput = z.input<typeof removeAdminSchema>;
