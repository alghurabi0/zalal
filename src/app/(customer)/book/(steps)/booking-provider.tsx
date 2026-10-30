"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import type { AddressSummary } from "@/app/(customer)/addresses/address-picker";
import { useOtherDay } from "@/components/booking/use-other-day";
import type { DayOption } from "@/lib/booking/availability";
import {
  type BookingDraft,
  newDraft,
  type PriceTable,
  reconcileDraft,
  type SavedTank,
  withRequestReset,
} from "@/lib/booking/draft";
import { getDraft, setDraft, subscribeDraft } from "@/lib/booking/draft-store";
import type { Subscription } from "@/lib/subscriptions/state";
import type { BookingError } from "@/lib/booking/errors";
import {
  type AddProblem,
  addFiles,
  dropExpiredUploads,
  getUploads,
  noUploads,
  removeUpload,
  retryUpload,
  subscribeUploads,
  type UploadItem,
  uploadsSettled,
} from "@/lib/booking/uploads";

/** What the server loads once for the three steps (layout.tsx). */
export type BookingData = {
  userId: string;
  address: AddressSummary;
  addresses: AddressSummary[];
  savedTanks: SavedTank[];
  prices: PriceTable;
  days: DayOption[];
  /** Every address's; Checkout uses the booking address's (coverageFor). */
  subscriptions: Subscription[];
};

type BookingContextValue = {
  data: BookingData;
  /** Null until the stored draft is read (after hydration). */
  draft: BookingDraft | null;
  /** Applies `change` to the latest draft (not the one this render saw). */
  update: (change: (draft: BookingDraft) => BookingDraft) => void;
  /** The latest draft, for code that resumes after an await. */
  latestDraft: () => BookingDraft;
  uploads: UploadItem[];
  /** Waits until no file is being checked or uploaded. */
  uploadsSettled: () => Promise<UploadItem[]>;
  /** Forgets finished uploads too old to book; returns how many (see uploads.ts). */
  dropExpiredUploads: (options?: { unknownAge?: boolean }) => number;
  addFiles: (files: File[]) => Promise<AddProblem[]>;
  retryUpload: (id: string) => void;
  removeUpload: (id: string) => void;
  /** Adds a day picked in the month calendar to data.days (useOtherDay). */
  pickOtherDay: (day: DayOption) => void;
  /** A problem Checkout sent the customer back to fix. */
  notice: BookingError | null;
  setNotice: (notice: BookingError | null) => void;
};

const BookingContext = createContext<BookingContextValue | null>(null);

const notRead = () => undefined;

/**
 * Holds the booking across steps 1–3. It sits in the steps' layout, which
 * stays mounted while the customer moves between them, and the draft and the
 * uploads live in stores outside React (sessionStorage-backed), so uploads
 * keep running and a reload keeps the choices.
 */
export function BookingProvider({
  data: serverData,
  children,
}: {
  data: BookingData;
  children: ReactNode;
}) {
  const { userId } = serverData;
  const stored = useSyncExternalStore(subscribeDraft, () => getDraft(userId), notRead);
  const uploads = useSyncExternalStore(subscribeUploads, () => getUploads(userId), noUploads);
  const [notice, setNotice] = useState<BookingError | null>(null);
  // The row of days plus a day picked in the calendar (also after a reload).
  const otherDay = useOtherDay(serverData.days, stored?.serviceDate ?? null);
  const data = useMemo(() => ({ ...serverData, days: otherDay.days }), [serverData, otherDay.days]);

  const context = useMemo(
    () => ({ addressId: data.address.id, savedTanks: data.savedTanks, days: data.days }),
    [data.address.id, data.savedTanks, data.days],
  );
  // The stored draft, brought in line with the address, tanks and slots the
  // server just sent. Pure, so it runs while rendering.
  const draft = useMemo(() => {
    if (stored === undefined) return null;
    return stored ? reconcileDraft(stored, context) : newDraft(context);
  }, [stored, context]);

  const latestDraft = useCallback(() => {
    const current = getDraft(userId);
    return current ? reconcileDraft(current, context) : newDraft(context);
  }, [userId, context]);

  const update = useCallback(
    (change: (draft: BookingDraft) => BookingDraft) => {
      const current = latestDraft();
      setDraft(userId, withRequestReset(current, change(current)));
      // A notice from Checkout is about the booking as it was.
      setNotice(null);
    },
    [latestDraft, userId],
  );

  const value = useMemo<BookingContextValue>(
    () => ({
      data,
      draft,
      update,
      latestDraft,
      uploads,
      uploadsSettled: () => uploadsSettled(userId),
      dropExpiredUploads: (options) => dropExpiredUploads(userId, options),
      addFiles: (files) => addFiles(userId, files),
      retryUpload: (id) => retryUpload(userId, id),
      removeUpload: (id) => removeUpload(userId, id),
      pickOtherDay: otherDay.pick,
      notice,
      setNotice,
    }),
    [data, draft, update, latestDraft, uploads, otherDay.pick, notice, userId],
  );

  return <BookingContext value={value}>{children}</BookingContext>;
}

export function useBooking(): BookingContextValue {
  const value = useContext(BookingContext);
  if (!value) throw new Error("useBooking needs a BookingProvider (book/(steps)/layout.tsx)");
  return value;
}
