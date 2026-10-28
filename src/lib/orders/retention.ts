import type { OrderStatus } from "./status";
import type { OrderEventRow } from "./timeline";

/**
 * Booking videos are deleted this many days after the order closed
 * (private.purge_expired_media, migration qa_retention; spec §11, §13).
 */
export const VIDEO_RETENTION_DAYS = 90;

const CLOSED: readonly OrderStatus[] = ["completed", "cancelled", "no_show"];

/**
 * Whether the order's booking videos are past retention: closed, counted
 * from the event into its current status, as the purge counts it.
 */
export function videosExpired(
  status: OrderStatus,
  events: Pick<OrderEventRow, "to_status" | "created_at">[],
  now: Date,
): boolean {
  if (!CLOSED.includes(status)) return false;
  const closedAt = Math.max(
    ...events.filter((e) => e.to_status === status).map((e) => Date.parse(e.created_at)),
  );
  return (
    Number.isFinite(closedAt) &&
    now.getTime() - closedAt > VIDEO_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
}
