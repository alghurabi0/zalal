import { z } from "zod";

import { RATING_TAGS } from "@/lib/certificates/format";

// Report's rating (spec §5.15): shared by the form and the Server Action.
// rate_order() checks the same rules again.

export const RATING_COMMENT_MAX = 500;

export const rateOrderSchema = z.object({
  orderId: z.uuid(),
  stars: z.int().min(1).max(5),
  tags: z
    .array(z.enum(RATING_TAGS))
    .max(RATING_TAGS.length)
    .transform((tags) => [...new Set(tags)]),
  comment: z
    .string()
    .trim()
    .max(RATING_COMMENT_MAX)
    .transform((value) => (value === "" ? null : value)),
});

export type RateOrderInput = z.input<typeof rateOrderSchema>;
