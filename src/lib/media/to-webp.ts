/**
 * Scales an image down to `maxEdge` px on its longer edge and converts it to
 * WebP (transparency kept), on the main thread. A11's covers and A13's
 * certificate stamp share it.
 */
export async function toWebp(file: File, maxEdge: number): Promise<File> {
  const { default: imageCompression } = await import("browser-image-compression");
  const smaller = await imageCompression(file, {
    maxWidthOrHeight: maxEdge,
    fileType: "image/webp",
    initialQuality: 0.82,
    // The worker would load the library from a CDN.
    useWebWorker: false,
  });
  return new File([smaller], "image.webp", { type: "image/webp" });
}

/** public-content's cap (migration storage_buckets). */
export const PUBLIC_CONTENT_MAX_BYTES = 5 * 1024 * 1024;
