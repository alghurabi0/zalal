// Database errors from the crew's status changes (transition_order; codes
// in supabase/CLAUDE.md), as C3 shows them. ZL011 carries the missing
// requirement in its message.

export const CREW_JOB_ERRORS = [
  "invalid_transition",
  "reason_required",
  "cash_not_collected",
  "crew_not_assigned",
  "not_found",
  "failed",
] as const;

export type CrewJobError = (typeof CREW_JOB_ERRORS)[number];

const requirements = new Set<string>([
  "reason_required",
  "cash_not_collected",
  "crew_not_assigned",
]);

export function crewJobErrorFor(
  error: { code?: string; message?: string } | null | undefined,
): CrewJobError {
  if (!error?.code) return "failed";
  if (error.code === "ZL010") return "invalid_transition";
  // The job was given to another crew, or the crew was switched off.
  if (error.code === "P0002") return "not_found";
  if (error.code === "ZL011" && error.message && requirements.has(error.message)) {
    return error.message as CrewJobError;
  }
  return "failed";
}
