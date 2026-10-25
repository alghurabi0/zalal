import type { Upload } from "tus-js-client";
import { z } from "zod";

import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/browser";

import {
  bookingObjectPath,
  bookingObjectPathPattern,
  contentTypeOf,
  MAX_BOOKING_FILES,
  MAX_FILE_BYTES,
  MAX_VIDEO_SECONDS,
  type MediaKind,
  mediaKindOf,
  ORDER_MEDIA_BUCKET,
  PHOTO_MAX_EDGE,
  roundDuration,
  videoProblem,
} from "./media";

// Booking step 2's uploads (spec §5.10), outside React so they keep running
// while the customer moves between steps, and read with
// useSyncExternalStore. Files go straight from the phone to Storage
// (order-media, customer/<user id>/…) over TUS, which resumes after a
// dropped connection; the storage policy decides who may write there.
// Finished uploads are remembered in sessionStorage per user, so a reload
// keeps them; one still running when the page reloads is lost.

export type UploadStatus = "preparing" | "uploading" | "done" | "failed";

export type UploadItem = {
  id: string;
  /** Its number among files of its kind ("فيديو 2"). */
  n: number;
  kind: MediaKind;
  bytes: number;
  /** Videos only, read on the device. */
  durationS: number | null;
  path: string;
  status: UploadStatus;
  /** 0–100. */
  progress: number;
};

export type AddProblem = "too_many" | "unsupported" | "too_long" | "too_big" | "unreadable";

const storedSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      n: z.number().int().positive(),
      kind: z.enum(["photo", "video"]),
      bytes: z.number().int().nonnegative(),
      durationS: z.number().min(0).max(MAX_VIDEO_SECONDS).nullable(),
      path: z.string().regex(bookingObjectPathPattern),
    }),
  )
  .max(MAX_BOOKING_FILES);

type Listener = () => void;
type Running = { file: File; contentType: string; upload?: Upload };

const listeners = new Set<Listener>();
const running = new Map<string, Running>();
let state: { key: string; items: UploadItem[] } | null = null;

const EMPTY: UploadItem[] = [];
const storageKey = (userId: string) => `zl_booking_files:${userId}`;

/** For the server render and hydration: no uploads yet. */
export const noUploads = () => EMPTY;

export function getUploads(userId: string): UploadItem[] {
  const key = storageKey(userId);
  if (state?.key !== key) {
    // Another account on this tab: drop the previous one's uploads.
    for (const job of running.values()) void job.upload?.abort();
    running.clear();
    state = { key, items: restore(key) };
  }
  return state.items;
}

export function subscribeUploads(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function restore(key: string): UploadItem[] {
  try {
    const parsed = storedSchema.safeParse(JSON.parse(window.sessionStorage.getItem(key) ?? "[]"));
    if (!parsed.success) return EMPTY;
    return parsed.data.map((file) => ({ ...file, status: "done", progress: 100 }));
  } catch {
    return EMPTY;
  }
}

function update(userId: string, change: (items: UploadItem[]) => UploadItem[]) {
  const items = change(getUploads(userId));
  state = { key: storageKey(userId), items };
  try {
    const done = items
      .filter((item) => item.status === "done")
      .map(({ id, n, kind, bytes, durationS, path }) => ({ id, n, kind, bytes, durationS, path }));
    window.sessionStorage.setItem(storageKey(userId), JSON.stringify(done));
  } catch {
    // Storage blocked: the uploads still work until a reload.
  }
  for (const listener of listeners) listener();
}

function patch(userId: string, id: string, changes: Partial<UploadItem>) {
  update(userId, (items) => items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
}

/**
 * Checks the picked files, adds the ones that fit and starts uploading them.
 * Resolves with what was refused, once every file is checked.
 */
export async function addFiles(userId: string, files: File[]): Promise<AddProblem[]> {
  const problems: AddProblem[] = [];
  const room = MAX_BOOKING_FILES - getUploads(userId).length;
  if (files.length > room) problems.push("too_many");

  const checks = files.slice(0, Math.max(room, 0)).map(async (file) => {
    const contentType = contentTypeOf(file);
    if (!contentType) {
      problems.push("unsupported");
      return;
    }
    const kind = mediaKindOf(contentType);
    const id = crypto.randomUUID();
    const items = getUploads(userId);
    const n = 1 + Math.max(0, ...items.filter((i) => i.kind === kind).map((i) => i.n));
    update(userId, (current) => [
      ...current,
      {
        id,
        n,
        kind,
        bytes: file.size,
        durationS: null,
        path: bookingObjectPath(userId, id, contentType),
        status: "preparing",
        progress: 0,
      },
    ]);

    const prepared = kind === "video" ? await checkVideo(file) : await shrinkPhoto(file);
    if ("problem" in prepared) {
      problems.push(prepared.problem);
      update(userId, (current) => current.filter((item) => item.id !== id));
      return;
    }
    // Removed while it was being checked.
    if (!getUploads(userId).some((item) => item.id === id)) return;
    running.set(id, { file: prepared.file, contentType });
    patch(userId, id, {
      bytes: prepared.file.size,
      durationS: prepared.durationS,
      status: "uploading",
    });
    void start(userId, id);
  });

  await Promise.all(checks);
  return problems;
}

export function retryUpload(userId: string, id: string) {
  const job = running.get(id);
  if (!job) return;
  patch(userId, id, { status: "uploading" });
  if (job.upload) job.upload.start();
  else void start(userId, id);
}

/** The × on a file: stops the upload, or deletes the finished file from Storage. */
export function removeUpload(userId: string, id: string) {
  const item = getUploads(userId).find((i) => i.id === id);
  if (!item) return;
  const job = running.get(id);
  running.delete(id);
  update(userId, (items) => items.filter((i) => i.id !== id));
  if (job?.upload && item.status !== "done") {
    // true: also ends the upload on the server.
    void job.upload.abort(true).catch(() => undefined);
  } else if (item.status === "done") {
    // Best effort: an unattached file left behind is only clutter.
    void createClient()
      .storage.from(ORDER_MEDIA_BUCKET)
      .remove([item.path])
      .catch(() => undefined);
  }
}

const isBusy = (item: UploadItem) => item.status === "preparing" || item.status === "uploading";

/**
 * Resolves with the list once no file is being checked or uploaded (spec
 * §5.10: confirming waits for the uploads). Failed ones stay failed.
 */
export function uploadsSettled(userId: string): Promise<UploadItem[]> {
  return new Promise((resolve) => {
    let unsubscribe: () => void = () => undefined;
    const check = () => {
      const items = getUploads(userId);
      if (items.some(isBusy)) return;
      unsubscribe();
      resolve(items);
    };
    unsubscribe = subscribeUploads(check);
    check();
  });
}

/** After booking: the files now belong to the order, so forget them without deleting. */
export function clearUploads(userId: string) {
  running.clear();
  update(userId, () => EMPTY);
}

async function start(userId: string, id: string) {
  const job = running.get(id);
  const item = getUploads(userId).find((i) => i.id === id);
  if (!job || !item) return;

  const { Upload } = await import("tus-js-client");
  const env = publicEnv();
  const supabase = createClient();
  let shown = 0;

  const upload = new Upload(job.file, {
    endpoint: `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
    retryDelays: [0, 1000, 3000, 5000, 10000],
    // Supabase's TUS server takes 6 MB chunks only.
    chunkSize: 6 * 1024 * 1024,
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "x-upsert": "false" },
    metadata: {
      bucketName: ORDER_MEDIA_BUCKET,
      objectName: item.path,
      contentType: job.contentType,
      cacheControl: "3600",
    },
    // A fresh token for every request: a long video can outlive one.
    onBeforeRequest: async (request) => {
      const { data } = await supabase.auth.getSession();
      if (data.session) request.setHeader("Authorization", `Bearer ${data.session.access_token}`);
    },
    onProgress: (sent, total) => {
      // 100 waits for onSuccess, when Storage has the whole file.
      const percent = Math.min(99, Math.floor((sent / total) * 100));
      if (percent !== shown) {
        shown = percent;
        patch(userId, id, { progress: percent });
      }
    },
    onSuccess: () => {
      if (running.has(id)) patch(userId, id, { status: "done", progress: 100 });
    },
    onError: () => {
      if (running.has(id)) patch(userId, id, { status: "failed" });
    },
  });
  job.upload = upload;

  const previous = await upload.findPreviousUploads();
  if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
  if (running.get(id) === job) upload.start();
}

type Prepared = { file: File; durationS: number | null } | { problem: AddProblem };

async function checkVideo(file: File): Promise<Prepared> {
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
async function shrinkPhoto(file: File): Promise<Prepared> {
  let result: File = file;
  try {
    const { default: imageCompression } = await import("browser-image-compression");
    const smaller = await imageCompression(file, {
      maxWidthOrHeight: PHOTO_MAX_EDGE,
      initialQuality: 0.8,
      // The worker would load the library from a CDN; the main thread is
      // fast enough for four photos.
      useWebWorker: false,
    });
    if (smaller.size < file.size) result = new File([smaller], file.name, { type: file.type });
  } catch {
    result = file;
  }
  if (result.size > MAX_FILE_BYTES) return { problem: "too_big" };
  return { file: result, durationS: null };
}
