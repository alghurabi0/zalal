import { type ContentType, extensionFor } from "@/lib/booking/media";

// The Issue report's files (spec §5.17): up to 3, with Upload's limits
// (photos shrunk to about 1600 px, videos up to 60 s and 100 MB). They go to
// the customer's own folder in ticket-media, which the storage policy
// requires (migration tickets_app); create_ticket() then attaches them.

export const TICKET_MEDIA_BUCKET = "ticket-media";
export const MAX_TICKET_FILES = 3;

/** `<user id>/<random>.<ext>` */
export function ticketObjectPath(userId: string, fileId: string, contentType: ContentType): string {
  return `${userId}/${fileId}.${extensionFor(contentType)}`;
}

/** The pattern ticketObjectPath() makes, for checking paths the client sends. */
export const ticketObjectPathPattern =
  /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif|mp4|mov|webm)$/;
