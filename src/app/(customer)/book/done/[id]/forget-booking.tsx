"use client";

import { useEffect } from "react";

import { getDraft, setDraft } from "@/lib/booking/draft-store";
import { clearUploads } from "@/lib/booking/uploads";

/**
 * The booking is made: forget its draft and uploads (the files now belong to
 * the order), so احجز starts a new one. Only the draft that made this order:
 * an old N5 opened again (back button, a kept-alive page) leaves a booking
 * in progress alone.
 */
export function ForgetBooking({ userId, requestId }: { userId: string; requestId: string }) {
  useEffect(() => {
    if (getDraft(userId)?.requestId !== requestId) return;
    setDraft(userId, null);
    clearUploads(userId);
  }, [userId, requestId]);
  return null;
}
