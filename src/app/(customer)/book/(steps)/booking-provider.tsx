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
import type { DayOption } from "@/lib/booking/availability";
import {
  type BookingDraft,
  newDraft,
  type PriceTable,
  reconcileDraft,
  type SavedTank,
} from "@/lib/booking/draft";
import { getDraft, setDraft, subscribeDraft } from "@/lib/booking/draft-store";
import type { BookingError } from "@/lib/booking/errors";
import {
  type AddProblem,
  addFiles,
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
  maxTanks: number;
};

type BookingContextValue = {
  data: BookingData;
  /** Null until the stored draft is read (after hydration). */
  draft: BookingDraft | null;
  update: (change: (draft: BookingDraft) => BookingDraft) => void;
  uploads: UploadItem[];
  /** Waits until no file is being checked or uploaded. */
  uploadsSettled: () => Promise<UploadItem[]>;
  addFiles: (files: File[]) => Promise<AddProblem[]>;
  retryUpload: (id: string) => void;
  removeUpload: (id: string) => void;
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
export function BookingProvider({ data, children }: { data: BookingData; children: ReactNode }) {
  const { userId } = data;
  const stored = useSyncExternalStore(subscribeDraft, () => getDraft(userId), notRead);
  const uploads = useSyncExternalStore(subscribeUploads, () => getUploads(userId), noUploads);
  const [notice, setNotice] = useState<BookingError | null>(null);

  // The stored draft, brought in line with the address, tanks and slots the
  // server just sent. Pure, so it runs while rendering.
  const draft = useMemo(() => {
    if (stored === undefined) return null;
    const context = { addressId: data.address.id, savedTanks: data.savedTanks, days: data.days };
    return stored ? reconcileDraft(stored, context) : newDraft(context);
  }, [stored, data.address.id, data.savedTanks, data.days]);

  const update = useCallback(
    (change: (draft: BookingDraft) => BookingDraft) => {
      if (draft) setDraft(userId, change(draft));
    },
    [draft, userId],
  );

  const value = useMemo<BookingContextValue>(
    () => ({
      data,
      draft,
      update,
      uploads,
      uploadsSettled: () => uploadsSettled(userId),
      addFiles: (files) => addFiles(userId, files),
      retryUpload: (id) => retryUpload(userId, id),
      removeUpload: (id) => removeUpload(userId, id),
      notice,
      setNotice,
    }),
    [data, draft, update, uploads, notice, userId],
  );

  return <BookingContext value={value}>{children}</BookingContext>;
}

export function useBooking(): BookingContextValue {
  const value = useContext(BookingContext);
  if (!value) throw new Error("useBooking needs a BookingProvider (book/(steps)/layout.tsx)");
  return value;
}
