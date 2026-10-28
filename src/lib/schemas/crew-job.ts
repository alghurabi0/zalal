import { z } from "zod";

import { MAX_VIDEO_SECONDS } from "@/lib/booking/media";
import { type CrewJobError, FINISH_FIELD_ERRORS } from "@/lib/crew/errors";
import { JOB_MEDIA_KINDS, orderIdOfPath } from "@/lib/crew/media";

import { STAFF_NOTE_MAX, staffReasonSchema } from "./admin-order";

// The crew's status changes and media as their Server Actions receive them
// (spec §6, §8.1 C3a, C3b, C4). transition_order() and attach_job_media()
// check the crew, the move and its requirements again.

export const advanceJobSchema = z.object({
  orderId: z.uuid(),
  toStatus: z.enum(["on_the_way", "arrived", "in_progress"]),
});

/** The C4 sterilant (job_reports.sterilant). */
export const STERILANT_MIN = 2;
export const STERILANT_MAX = 120;
/** mg/L; any reading in range is taken (spec §1: no reading validation). */
export const CHLORINE_MAX = 10;

const oneDecimal = (value: number) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;

const invalidChlorine = { error: "invalid_chlorine" } as const;

export const residualChlorineSchema = z
  .number(invalidChlorine)
  .min(0, invalidChlorine)
  .max(CHLORINE_MAX, invalidChlorine)
  .refine(oneDecimal, invalidChlorine)
  .nullable();

/**
 * C4. Each issue's message is the error key the form shows. A subscription
 * order (`covered`, Phase 6) has no cash to collect; the database decides
 * from the order itself, so a wrong flag only gets cash_not_collected back.
 */
export const finishJobSchema = z
  .object({
    orderId: z.uuid(),
    covered: z.boolean(),
    cashCollected: z.boolean(),
    sterilant: z
      .string()
      .trim()
      .min(1, { error: "sterilant_required" })
      .min(STERILANT_MIN, { error: "invalid_sterilant" })
      .max(STERILANT_MAX, { error: "invalid_sterilant" }),
    residualChlorine: residualChlorineSchema,
    note: z.string().trim().max(STAFF_NOTE_MAX, { error: "note_too_long" }),
  })
  .refine((input) => input.covered || input.cashCollected, { error: "cash_not_collected" });

/** The form error for a refused C4 input: the first issue's key, else "failed". */
export function finishErrorOf(error: z.ZodError): CrewJobError {
  const message = error.issues[0]?.message;
  return FINISH_FIELD_ERRORS.find((key) => key === message) ?? "failed";
}

/**
 * The chlorine box as typed: empty is no reading, Arabic-Indic digits and
 * the Arabic decimal mark are read too. NaN for anything else.
 */
export function parseChlorine(text: string): number | null {
  const western = text
    .trim()
    // Arabic-Indic digits (U+0660–U+0669) and the Arabic decimal mark (U+066B).
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u066B,]/g, ".");
  if (western === "") return null;
  return /^\d{1,2}(\.\d+)?$/.test(western) ? Number(western) : Number.NaN;
}

export const crewNoShowSchema = z.object({ orderId: z.uuid(), note: staffReasonSchema });

/** C3b: a finished upload from the crew's folder for this order. */
export const attachJobMediaSchema = z
  .object({
    orderId: z.uuid(),
    kind: z.enum(JOB_MEDIA_KINDS),
    path: z.string(),
    durationS: z.number().min(0).max(MAX_VIDEO_SECONDS).nullable(),
  })
  .refine((input) => orderIdOfPath(input.path) === input.orderId);

export const removeJobMediaSchema = z.object({ orderId: z.uuid(), mediaId: z.uuid() });

export type AdvanceJobInput = z.input<typeof advanceJobSchema>;
export type FinishJobInput = z.input<typeof finishJobSchema>;
export type CrewNoShowInput = z.input<typeof crewNoShowSchema>;
export type AttachJobMediaInput = z.input<typeof attachJobMediaSchema>;
export type RemoveJobMediaInput = z.input<typeof removeJobMediaSchema>;

/** GPS while on the way (§8.1): one fix as the phone reports it. */
export const shareLocationSchema = z.object({
  orderId: z.uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100_000),
});

export type ShareLocationInput = z.input<typeof shareLocationSchema>;
