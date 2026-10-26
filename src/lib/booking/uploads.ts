import type { Upload } from "tus-js-client";
import { z } from "zod";

import { checkVideo, type PrepareProblem, shrinkPhoto } from "@/lib/media/prepare";
import { createTusUpload } from "@/lib/media/tus";
import { createClient } from "@/lib/supabase/browser";

import {
  bookingObjectPath,
  bookingObjectPathPattern,
  contentTypeOf,
  MAX_BOOKING_FILES,
  MAX_VIDEO_SECONDS,
  type MediaKind,
  mediaKindOf,
  ORDER_MEDIA_BUCKET,
  uploadExpired,
} from "./media";

// Booking step 2's uploads (spec §5.10), outside React so they keep running
// while the customer moves between steps, and read with
// useSyncExternalStore. Files go straight from the phone to Storage
// (order-media, customer/<user id>/…) over TUS, which resumes after a
// dropped connection; the storage policy decides who may write there.
// Finished uploads are remembered in sessionStorage per user, so a reload
// keeps them; one still running when the page reloads is lost. A finished
// upload too old to book (uploadExpired) is forgotten: on reload, and when
// Checkout confirms.

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
  /** When the upload finished (device clock, ms); null until then. */
  uploadedAt: number | null;
};

export type AddProblem = "too_many" | "unsupported" | PrepareProblem;

const storedSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      n: z.number().int().positive(),
      kind: z.enum(["photo", "video"]),
      bytes: z.number().int().nonnegative(),
      durationS: z.number().min(0).max(MAX_VIDEO_SECONDS).nullable(),
      path: z.string().regex(bookingObjectPathPattern),
      // Missing in files saved before it was added: their age is unknown.
      uploadedAt: z.number().int().nonnegative().nullable().optional(),
    }),
  )
  .max(MAX_BOOKING_FILES);

type Listener = () => void;
type Running = { file: File; contentType: string; upload?: Upload };

const listeners = new Set<Listener>();
const running = new Map<string, Running>();
let state: { key: string; items: UploadItem[] } | null = null;
/** The finished files last written to sessionStorage. */
let saved: string | null = null;
/** Files the last restore forgot as too old, until Checkout reports them. */
let forgotten = 0;

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
    saved = null;
    const restored = restore(key);
    forgotten = restored.forgotten;
    state = { key, items: restored.items };
  }
  return state.items;
}

export function subscribeUploads(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function restore(key: string): { items: UploadItem[]; forgotten: number } {
  try {
    const parsed = storedSchema.safeParse(JSON.parse(window.sessionStorage.getItem(key) ?? "[]"));
    if (!parsed.success) return { items: EMPTY, forgotten: 0 };
    const now = Date.now();
    const files = parsed.data.map((file) => ({
      ...file,
      uploadedAt: file.uploadedAt ?? null,
      status: "done" as const,
      progress: 100,
    }));
    const items = files.filter((file) => !uploadExpired(file.uploadedAt, now));
    return { items, forgotten: files.length - items.length };
  } catch {
    return { items: EMPTY, forgotten: 0 };
  }
}

function update(userId: string, change: (items: UploadItem[]) => UploadItem[]) {
  const items = change(getUploads(userId));
  state = { key: storageKey(userId), items };
  // Only finished files are kept, so progress ticks don't touch storage.
  const done = JSON.stringify(
    items
      .filter((item) => item.status === "done")
      .map(({ id, n, kind, bytes, durationS, path, uploadedAt }) => ({
        id,
        n,
        kind,
        bytes,
        durationS,
        path,
        uploadedAt,
      })),
  );
  if (done !== saved) {
    saved = done;
    try {
      window.sessionStorage.setItem(storageKey(userId), done);
    } catch {
      // Storage blocked: the uploads still work until a reload.
    }
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
  // Adding files means the customer has seen Photos since a reload forgot any.
  forgotten = 0;
  const problems: AddProblem[] = [];
  const supported = files.flatMap((file) => {
    const contentType = contentTypeOf(file);
    if (contentType) return [{ file, contentType }];
    problems.push("unsupported");
    return [];
  });
  const room = MAX_BOOKING_FILES - getUploads(userId).length;
  if (supported.length > room) problems.push("too_many");

  const checks = supported.slice(0, Math.max(room, 0)).map(async ({ file, contentType }) => {
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
        uploadedAt: null,
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

/**
 * Forgets finished uploads too old to book, without deleting them (the
 * nightly cleanup does). With `unknownAge`, also those saved before their
 * upload time was kept: for when create_order() has refused a file anyway.
 * Returns how many went, counting the ones a reload already forgot, so
 * Checkout can send the customer back to add them again.
 */
export function dropExpiredUploads(
  userId: string,
  { now = Date.now(), unknownAge = false }: { now?: number; unknownAge?: boolean } = {},
): number {
  const items = getUploads(userId);
  const kept = items.filter(
    (item) =>
      item.status !== "done" ||
      !(uploadExpired(item.uploadedAt, now) || (unknownAge && item.uploadedAt === null)),
  );
  if (kept.length !== items.length) update(userId, () => kept);
  const dropped = items.length - kept.length + forgotten;
  forgotten = 0;
  return dropped;
}

/** After booking: the files now belong to the order, so forget them without deleting. */
export function clearUploads(userId: string) {
  forgotten = 0;
  for (const job of running.values()) void job.upload?.abort().catch(() => undefined);
  running.clear();
  update(userId, () => EMPTY);
}

async function start(userId: string, id: string) {
  try {
    await startUpload(userId, id);
  } catch {
    // The library didn't load (offline) or the upload couldn't start.
    if (running.has(id)) patch(userId, id, { status: "failed" });
  }
}

async function startUpload(userId: string, id: string) {
  const job = running.get(id);
  const item = getUploads(userId).find((i) => i.id === id);
  if (!job || !item) return;

  const upload = await createTusUpload(
    job.file,
    { path: item.path, contentType: job.contentType },
    {
      onProgress: (percent) => patch(userId, id, { progress: percent }),
      onSuccess: () => {
        if (running.has(id)) {
          patch(userId, id, { status: "done", progress: 100, uploadedAt: Date.now() });
        }
      },
      onError: () => {
        if (running.has(id)) patch(userId, id, { status: "failed" });
      },
    },
  );
  job.upload = upload;
  if (running.get(id) === job) upload.start();
}
