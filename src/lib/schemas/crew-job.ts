import { z } from "zod";

import { staffReasonSchema } from "./admin-order";

// The crew's status changes as their Server Actions receive them (spec §6,
// §8.1 C3a, C4). transition_order() checks the crew, the move and its
// requirements again.

export const advanceJobSchema = z.object({
  orderId: z.uuid(),
  toStatus: z.enum(["on_the_way", "arrived", "in_progress"]),
});

/** C4. Part B adds the sterilant, residual chlorine and a note. */
export const finishJobSchema = z.object({
  orderId: z.uuid(),
  cashCollected: z.literal(true),
});

export const crewNoShowSchema = z.object({ orderId: z.uuid(), note: staffReasonSchema });

export type AdvanceJobInput = z.input<typeof advanceJobSchema>;
export type FinishJobInput = z.input<typeof finishJobSchema>;
export type CrewNoShowInput = z.input<typeof crewNoShowSchema>;
