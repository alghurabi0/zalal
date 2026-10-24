import { z } from "zod";

/** Collapses runs of whitespace and trims, so "  أحمد   علي " saves as "أحمد علي". */
export const cleanText = (value: string) => value.replace(/\s+/g, " ").trim();

/** Name (N1, N10): 2–40 characters after trimming, as profiles.full_name checks. */
export const fullNameSchema = z
  .string()
  .transform(cleanText)
  .pipe(z.string().min(2, "too_short").max(40, "too_long"));

export const nameInputSchema = z.object({ fullName: fullNameSchema });
