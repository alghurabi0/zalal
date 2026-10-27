import { z } from "zod";

import { MAX_AREA_POINTS, pointCount } from "@/lib/admin/geojson";
import { normalizeIraqiPhone, toWesternDigits } from "@/lib/phone";

import { tankSizes, tankTypes } from "./tank";

// What the A8, A9 and A13 forms send to their Server Actions (spec §8.2).
// The admin RPCs and the tables' checks validate everything again.

/** price_list.price_iqd: whole IQD, 1–10,000,000. */
export const PRICE_MAX = 10_000_000;

/**
 * A typed price ("35,000", "35000", or with Arabic-Indic digits and the
 * Arabic thousands separator) as whole IQD; null when it isn't one in range.
 */
export function parsePrice(text: string): number | null {
  const digits = toWesternDigits(text).replace(/[\s,\u066C]/g, "");
  if (!/^\d{1,8}$/.test(digits)) return null;
  const value = Number(digits);
  return value >= 1 && value <= PRICE_MAX ? value : null;
}

export const pricesSchema = z
  .array(
    z.object({
      type: z.enum(tankTypes),
      size: z.enum(tankSizes),
      price: z.number().int().min(1).max(PRICE_MAX),
    }),
  )
  .length(tankTypes.length * tankSizes.length)
  .refine(
    (cells) => new Set(cells.map((c) => `${c.type}/${c.size}`)).size === cells.length,
    "duplicate_cell",
  );

/** Weekdays as stored: 0 = Sunday … 6 = Saturday (extract(dow)). */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
/** The order the screens list them in: the Iraqi week starts on Saturday. */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;

const weekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .transform((days) => [...new Set(days)].sort((a, b) => a - b));

/** slots.capacity */
export const CAPACITY_MAX = 20;
const capacitySchema = z.number().int().min(1).max(CAPACITY_MAX);

/** "HH:MM" from <input type="time"> (seconds dropped). */
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  .transform((value) => value.slice(0, 5));

export const createSlotSchema = z
  .object({
    start: timeSchema,
    end: timeSchema,
    capacity: capacitySchema,
    weekdays: weekdaysSchema,
  })
  .refine((slot) => slot.start < slot.end, { message: "end_before_start", path: ["end"] });

export const updateSlotSchema = z.object({
  id: z.number().int().positive(),
  capacity: capacitySchema,
  weekdays: weekdaysSchema,
  active: z.boolean(),
});

/** blocked_dates.reason: optional, 2–100 characters, trimmed. */
export const blockDateSchema = z.object({
  date: z.iso.date(),
  reason: z
    .string()
    .trim()
    .max(100)
    .refine((value) => value.length === 0 || value.length >= 2, "reason_too_short")
    .transform((value) => (value === "" ? null : value)),
});

export const unblockDateSchema = z.object({ date: z.iso.date() });

// Settings, one schema per A13 section. Keys are settings columns.

export const loginSettingsSchema = z.object({ sms_enabled: z.boolean() });

export const supportSettingsSchema = z
  .object({
    company_phone: z
      .string()
      .trim()
      .max(32)
      .transform((value, ctx) => {
        if (value === "") return null;
        const phone = normalizeIraqiPhone(value);
        if (phone === null) {
          ctx.addIssue({ code: "custom", message: "invalid_phone" });
          return z.NEVER;
        }
        return phone;
      }),
    working_hours_start: timeSchema,
    working_hours_end: timeSchema,
    working_days: z
      .array(z.number().int().min(0).max(6))
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  })
  .refine((s) => s.working_hours_start < s.working_hours_end, {
    message: "end_before_start",
    path: ["working_hours_end"],
  });

/** The ranges in the settings table's checks. */
export const SETTING_RANGES = {
  booking_window_days: [1, 60],
  cancel_cutoff_hours: [0, 48],
  max_tanks_per_order: [1, 20],
  cleaning_interval_months: [1, 24],
} as const;

const inRange = ([min, max]: readonly [number, number]) => z.number().int().min(min).max(max);

export const bookingSettingsSchema = z.object({
  booking_window_days: inRange(SETTING_RANGES.booking_window_days),
  cancel_cutoff_hours: inRange(SETTING_RANGES.cancel_cutoff_hours),
  max_tanks_per_order: inRange(SETTING_RANGES.max_tanks_per_order),
  cleaning_interval_months: inRange(SETTING_RANGES.cleaning_interval_months),
});

/** settings.sterilant_text */
export const STERILANT_MAX = 100;
export const crewSettingsSchema = z.object({
  sterilant_text: z.string().trim().max(STERILANT_MAX),
});

/** settings.certificate_text (spec §10.1 item 4). */
export const CERTIFICATE_TEXT_MAX = 800;
export const certificateSettingsSchema = z.object({
  certificate_text: z.string().trim().max(CERTIFICATE_TEXT_MAX),
});

/** settings.support_response_text: Chat's off-hours automatic reply (spec §5.16); empty turns it off. */
export const SUPPORT_REPLY_MAX = 300;
/** settings.ticket_response_hours: the Issue report's promised answer time (spec §5.17). */
export const TICKET_RESPONSE_RANGE = [1, 72] as const;
export const chatSettingsSchema = z.object({
  support_response_text: z.string().trim().max(SUPPORT_REPLY_MAX),
  ticket_response_hours: inRange(TICKET_RESPONSE_RANGE),
});

/** settings.terms_md / privacy_md */
export const LEGAL_MAX = 50_000;
export const legalSettingsSchema = z.object({
  terms_md: z.string().trim().max(LEGAL_MAX),
  privacy_md: z.string().trim().max(LEGAL_MAX),
});

export const settingsSectionSchema = z.discriminatedUnion("section", [
  z.object({ section: z.literal("login"), values: loginSettingsSchema }),
  z.object({ section: z.literal("support"), values: supportSettingsSchema }),
  z.object({ section: z.literal("booking"), values: bookingSettingsSchema }),
  z.object({ section: z.literal("crew"), values: crewSettingsSchema }),
  z.object({ section: z.literal("certificate"), values: certificateSettingsSchema }),
  z.object({ section: z.literal("chat"), values: chatSettingsSchema }),
  z.object({ section: z.literal("legal"), values: legalSettingsSchema }),
]);

export type SettingsSection = z.input<typeof settingsSectionSchema>["section"];

// Service areas.

const positionSchema = z.tuple([z.number().finite(), z.number().finite()]);
const ringSchema = z.array(positionSchema).min(4);
export const multiPolygonSchema = z
  .array(z.array(ringSchema).min(1))
  .min(1)
  .refine((area) => pointCount(area) <= MAX_AREA_POINTS, "too_many_points");

/** service_areas.name: 2–60 characters, trimmed. */
export const AREA_NAME_MAX = 60;
export const serviceAreaSchema = z.object({
  id: z.number().int().positive().nullable(),
  name: z.string().trim().min(2).max(AREA_NAME_MAX),
  active: z.boolean(),
  area: multiPolygonSchema,
});

export type PricesInput = z.input<typeof pricesSchema>;
export type CreateSlotInput = z.input<typeof createSlotSchema>;
export type UpdateSlotInput = z.input<typeof updateSlotSchema>;
export type BlockDateInput = z.input<typeof blockDateSchema>;
export type UnblockDateInput = z.input<typeof unblockDateSchema>;
export type SettingsSectionInput = z.input<typeof settingsSectionSchema>;
export type ServiceAreaInput = z.input<typeof serviceAreaSchema>;
