import type { Upload } from "tus-js-client";

import { ORDER_MEDIA_BUCKET } from "@/lib/booking/media";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/browser";

// A resumable (TUS) upload straight from the phone to Storage (order-media),
// as the logged-in user: the storage policies decide who may write where.
// Booking step 2 and the crew's media queue share it.

export type TusCallbacks = {
  /** 0–99; 100 waits for onSuccess, when Storage has the whole file. */
  onProgress: (percent: number) => void;
  onSuccess: () => void;
  /** The HTTP status Storage answered with, or null when there was no answer. */
  onError: (status: number | null) => void;
  /** The upload's own URL, to resume it after a reload. */
  onUrl?: (url: string) => void;
};

export async function createTusUpload(
  file: Blob,
  {
    path,
    contentType,
    uploadUrl,
  }: { path: string; contentType: string; uploadUrl?: string | null },
  callbacks: TusCallbacks,
): Promise<Upload> {
  const { Upload, DetailedError } = await import("tus-js-client");
  const env = publicEnv();
  const supabase = createClient();
  let shown = -1;

  const upload: Upload = new Upload(file, {
    endpoint: `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
    // Resumes this one upload (a crew file after a reload). When Storage no
    // longer knows it, tus starts a new upload of the same object.
    uploadUrl: uploadUrl ?? null,
    retryDelays: [0, 1000, 3000, 5000, 10000],
    // Supabase's TUS server takes 6 MB chunks only.
    chunkSize: 6 * 1024 * 1024,
    uploadDataDuringCreation: true,
    // tus would resume a stored upload of the same file (by name, size and
    // date), even one made for another object name. Each item makes its own
    // upload, resumed from memory or from the URL passed in.
    storeFingerprintForResuming: false,
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "x-upsert": "false" },
    metadata: {
      bucketName: ORDER_MEDIA_BUCKET,
      objectName: path,
      contentType,
      cacheControl: "3600",
    },
    // A fresh token for every request: a long video can outlive one.
    onBeforeRequest: async (request) => {
      const { data } = await supabase.auth.getSession();
      if (data.session) request.setHeader("Authorization", `Bearer ${data.session.access_token}`);
    },
    onUploadUrlAvailable: () => {
      if (upload.url) callbacks.onUrl?.(upload.url);
    },
    onProgress: (sent, total) => {
      const percent = Math.min(99, Math.floor((sent / total) * 100));
      if (percent !== shown) {
        shown = percent;
        callbacks.onProgress(percent);
      }
    },
    onSuccess: () => callbacks.onSuccess(),
    onError: (error) => {
      const status =
        error instanceof DetailedError ? (error.originalResponse?.getStatus() ?? null) : null;
      callbacks.onError(status || null);
    },
  });
  return upload;
}
