import { MAX_FILE_BYTES, PHOTO_MAX_EDGE, roundDuration, videoProblem } from "@/lib/booking/media";

// Getting a picked photo or video ready to upload, on the device (spec
// §5.10, §8.1 C3b): photos are scaled down, videos are checked for length
// and size (there is no server transcoding in v1). Booking step 2 and the
// crew's media queue share this.

export type PrepareProblem = "too_long" | "too_big" | "unreadable";

export type Prepared = { file: File; durationS: number | null } | { problem: PrepareProblem };

export async function checkVideo(file: File): Promise<Prepared> {
  const seconds = await readDuration(file);
  const problem = videoProblem({ bytes: file.size, durationS: seconds });
  if (problem || seconds === null) return { problem: problem ?? "unreadable" };
  return { file, durationS: roundDuration(seconds) };
}

/** Reads a video's length from its metadata, or null when the browser can't. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 15_000);
    video.preload = "metadata";
    video.muted = true;
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration)) {
        finish(video.duration);
        return;
      }
      // Some WebM recordings carry no duration: seeking to the end finds it.
      video.ontimeupdate = () => finish(Number.isFinite(video.duration) ? video.duration : null);
      video.currentTime = Number.MAX_SAFE_INTEGER;
    };
    video.src = url;
  });
}

/**
 * Scales a photo down to about 1600 px on its longer edge (spec §5.10). A
 * photo the browser can't decode (HEIC outside Safari) goes up as it is.
 */
export async function shrinkPhoto(file: File): Promise<Prepared> {
  let result: File = file;
  try {
    const { default: imageCompression } = await import("browser-image-compression");
    const smaller = await imageCompression(file, {
      maxWidthOrHeight: PHOTO_MAX_EDGE,
      initialQuality: 0.8,
      // The worker would load the library from a CDN; the main thread is
      // fast enough for a few photos.
      useWebWorker: false,
    });
    if (smaller.size < file.size) result = new File([smaller], file.name, { type: file.type });
  } catch {
    result = file;
  }
  if (result.size > MAX_FILE_BYTES) return { problem: "too_big" };
  return { file: result, durationS: null };
}
