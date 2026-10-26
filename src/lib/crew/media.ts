import { type ContentType, extensionFor } from "@/lib/booking/media";
import type { OrderStatus } from "@/lib/orders/status";

// The crew's job media (spec §8.1 C3b): before and after photos and clips,
// all optional. attach_job_media() checks every rule here again (migration
// crew_job_media); these only choose what C3 offers.

export const JOB_MEDIA_KINDS = ["before", "after", "clip"] as const;
export type JobMediaKind = (typeof JOB_MEDIA_KINDS)[number];

/** Per order and kind (ZL008 past these). */
export const JOB_MEDIA_LIMITS: Record<JobMediaKind, number> = { before: 10, after: 10, clip: 4 };

/**
 * What the crew can take now: before photos from arrival, after photos and
 * clips once work has started. (The database also takes uploads for 24 h
 * after completion, so a queue that was offline still lands.)
 */
export function captureKinds(status: OrderStatus): JobMediaKind[] {
  if (status === "arrived") return ["before"];
  if (status === "in_progress") return ["before", "after", "clip"];
  return [];
}

/** A wrong photo can be taken back while the job is open (remove_job_media). */
export function canRemoveJobMedia(status: OrderStatus): boolean {
  return status === "arrived" || status === "in_progress";
}

/** crew/<crew id>/<order id>/<file id>.<ext>: the folder the storage policy allows. */
export function jobObjectPath(
  crewId: string,
  orderId: string,
  fileId: string,
  contentType: ContentType,
): string {
  return `crew/${crewId}/${orderId}/${fileId}.${extensionFor(contentType)}`;
}

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The pattern jobObjectPath() makes, for checking paths the client sends. */
export const jobObjectPathPattern = new RegExp(
  `^crew/${uuid}/(${uuid})/${uuid}\\.(jpg|png|webp|heic|heif|mp4|mov|webm)$`,
);

/** The order a job media path belongs to, or null. */
export function orderIdOfPath(path: string): string | null {
  return jobObjectPathPattern.exec(path)?.[1] ?? null;
}
