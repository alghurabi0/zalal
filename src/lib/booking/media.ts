// Booking step 2 (spec §5.10): up to 4 photos or videos, videos at most 60 s
// and 100 MB. The order-media bucket enforces the size and the file types
// again, and create_order() checks the count; the duration is only known on
// the device (there is no server transcoding in v1).

export const MAX_BOOKING_FILES = 4;
export const MAX_VIDEO_SECONDS = 60;
/** The order-media bucket's file size limit (migration storage_buckets). */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** Photos are scaled down in the browser so their longer edge is about this. */
export const PHOTO_MAX_EDGE = 1600;
export const ORDER_MEDIA_BUCKET = "order-media";

export type MediaKind = "photo" | "video";

// The bucket's allow-list, with the extension each type is saved under.
const types = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
} as const;

type ContentType = keyof typeof types;

// Some browsers leave `type` empty for HEIC photos and .mov videos.
const byExtension: Record<string, ContentType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/** The file's type if the bucket accepts it, from its MIME type or else its extension. */
export function contentTypeOf(file: { type: string; name: string }): ContentType | null {
  const mime = file.type.toLowerCase();
  if (mime in types) return mime as ContentType;
  if (mime !== "") return null;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return byExtension[extension] ?? null;
}

export function mediaKindOf(contentType: ContentType): MediaKind {
  return contentType.startsWith("video/") ? "video" : "photo";
}

/** Why a picked video can't be uploaded, or null when it can. */
export function videoProblem({
  bytes,
  durationS,
}: {
  bytes: number;
  durationS: number | null;
}): "unreadable" | "too_long" | "too_big" | null {
  if (durationS === null || !Number.isFinite(durationS)) return "unreadable";
  // Half a second of slack: a phone's "1 minute" clip is often 60.2 s.
  if (durationS > MAX_VIDEO_SECONDS + 0.5) return "too_long";
  if (bytes > MAX_FILE_BYTES) return "too_big";
  return null;
}

/**
 * Where a customer's upload goes: their own folder, which the storage policy
 * requires (migration order_media_storage), under a random name.
 */
export function bookingObjectPath(
  userId: string,
  fileId: string,
  contentType: ContentType,
): string {
  return `customer/${userId}/${fileId}.${types[contentType]}`;
}

/** The pattern bookingObjectPath() makes, for checking paths the client sends. */
export const bookingObjectPathPattern =
  /^customer\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif|mp4|mov|webm)$/;

/** Durations are stored to a tenth of a second (order_media.duration_s numeric(4,1)). */
export function roundDuration(seconds: number): number {
  return Math.min(MAX_VIDEO_SECONDS, Math.round(seconds * 10) / 10);
}

/** "0:24" */
export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** "18 MB", "450 KB" (Upload's file rows). */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
