"use client";

import { useEffect } from "react";

import { setDraft } from "@/lib/booking/draft-store";
import { clearUploads } from "@/lib/booking/uploads";

/**
 * The booking is made: forget its draft and uploads (the files now belong to
 * the order), so احجز starts a new one.
 */
export function ForgetBooking({ userId }: { userId: string }) {
  useEffect(() => {
    setDraft(userId, null);
    clearUploads(userId);
  }, [userId]);
  return null;
}
