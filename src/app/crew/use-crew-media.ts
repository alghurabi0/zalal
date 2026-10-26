"use client";

import { useMediaQueue } from "@/lib/crew/use-media-queue";

import { attachJobMedia } from "./actions";

/** The crew's media queue, attaching through the Server Action. */
export function useCrewMedia(userId: string) {
  return useMediaQueue(userId, attachJobMedia);
}
