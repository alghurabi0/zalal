"use client";

import { useEffect, useSyncExternalStore } from "react";

import { ORDER_MEDIA_BUCKET } from "@/lib/booking/media";
import { checkVideo, shrinkPhoto } from "@/lib/media/prepare";
import { createTusUpload } from "@/lib/media/tus";
import { createClient } from "@/lib/supabase/browser";

import { type AttachResult, MediaQueue, type QueueItem } from "./media-queue";
import { deleteMediaStore, openMediaStore } from "./media-store";

// The phone's one media queue (media-queue.ts), with the browser's
// IndexedDB, TUS uploads and clock.

let queue: MediaQueue | null = null;
const EMPTY: QueueItem[] = [];

export function mediaQueue(): MediaQueue {
  if (queue) return queue;
  const created = new MediaQueue({
    openStore: openMediaStore,
    deleteStore: deleteMediaStore,
    upload: createTusUpload,
    prepare: (file, kind) => (kind === "video" ? checkVideo(file) : shrinkPhoto(file)),
    removeObject: async (path) => {
      await createClient().storage.from(ORDER_MEDIA_BUCKET).remove([path]);
    },
    online: () => navigator.onLine,
    now: () => Date.now(),
    setTimer: (run, ms) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  });
  window.addEventListener("online", () => created.wake());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) created.wake();
  });
  queue = created;
  return created;
}

/** Logout: every queued file on this phone is deleted, whichever account it was. */
export async function clearMediaQueue() {
  if (queue) await queue.clear();
  else await deleteMediaStore();
}

const subscribe = (listener: () => void) => mediaQueue().subscribe(listener);

/**
 * The account's queued files, live. Mounting it also starts the queue (or
 * resumes it after a reload), so every crew page keeps sending.
 */
export function useMediaQueue(
  userId: string,
  attach: (input: {
    orderId: string;
    kind: QueueItem["kind"];
    path: string;
    durationS: number | null;
  }) => Promise<AttachResult>,
): QueueItem[] {
  const items = useSyncExternalStore(
    subscribe,
    () => mediaQueue().getItems(userId),
    () => EMPTY,
  );
  useEffect(() => {
    void mediaQueue().start(userId, attach);
  }, [userId, attach]);
  return items;
}
