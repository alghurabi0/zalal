import { type ContentType, extensionFor } from "@/lib/booking/media";

// Chat attachments (spec §5.16): Upload's limits (photos shrunk to about
// 1600 px, videos up to 60 s and 100 MB), one file per message. Files go to
// the sender's own folder in chat-media, which the storage policy requires
// (migration chat); send_chat_message() then attaches them.

export const CHAT_MEDIA_BUCKET = "chat-media";

/** `<user id>/<random>.<ext>` */
export function chatObjectPath(userId: string, fileId: string, contentType: ContentType): string {
  return `${userId}/${fileId}.${extensionFor(contentType)}`;
}

/** The pattern chatObjectPath() makes, for checking paths the client sends. */
export const chatObjectPathPattern =
  /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif|mp4|mov|webm)$/;
