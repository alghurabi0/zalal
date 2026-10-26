// Database errors from the crew's status changes (transition_order) and
// media (attach_job_media, remove_job_media), as C3 shows them. Codes are in
// supabase/CLAUDE.md. ZL011 carries the missing requirement in its message,
// and 22023 the field the C4 form should have refused.

export const CREW_JOB_ERRORS = [
  "invalid_transition",
  "reason_required",
  "cash_not_collected",
  "crew_not_assigned",
  "sterilant_required",
  "invalid_sterilant",
  "invalid_chlorine",
  "note_too_long",
  "not_found",
  "failed",
] as const;

export type CrewJobError = (typeof CREW_JOB_ERRORS)[number];

/** The C4 fields' own errors, shown under the field. */
export const FINISH_FIELD_ERRORS = [
  "cash_not_collected",
  "sterilant_required",
  "invalid_sterilant",
  "invalid_chlorine",
  "note_too_long",
] as const satisfies readonly CrewJobError[];

const requirements = new Set<string>([
  "reason_required",
  "cash_not_collected",
  "crew_not_assigned",
  "sterilant_required",
]);

const invalidFields = new Set<string>(["invalid_sterilant", "invalid_chlorine"]);

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
  if (error.code === "22023" && error.message && invalidFields.has(error.message)) {
    return error.message as CrewJobError;
  }
  // The note's length check (order_event_notes).
  if (error.code === "23514") return "note_too_long";
  return "failed";
}

export type JobMediaError =
  "media_not_allowed" | "too_many_files" | "upload_not_found" | "not_found" | "failed";

/** Whether trying again later can help (no answer, or a server error). */
export const isLastingMediaError = (error: JobMediaError) => error !== "failed";

export function jobMediaErrorFor(
  error: { code?: string; message?: string } | null | undefined,
): JobMediaError {
  switch (error?.code) {
    case "ZL023":
      return "media_not_allowed";
    case "ZL008":
      return "too_many_files";
    case "ZL009":
      return "upload_not_found";
    case "P0002":
      return "not_found";
    default:
      return "failed";
  }
}
