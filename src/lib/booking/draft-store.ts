import { type BookingDraft, bookingDraftSchema } from "./draft";

// The booking in progress, kept in sessionStorage per user so a reload or a
// trip to Location doesn't lose it, and read with useSyncExternalStore.
// sessionStorage is per tab and gone when the tab closes; the key carries
// the user id so a shared phone never shows one account's draft to another.

type Listener = () => void;

const listeners = new Set<Listener>();
let cache: { key: string; draft: BookingDraft | null } | null = null;

const storageKey = (userId: string) => `zl_booking:${userId}`;

function read(key: string): BookingDraft | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = bookingDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Blocked storage or bad JSON: start a fresh booking.
    return null;
  }
}

/** The stored draft, or null for none. The same object until it changes. */
export function getDraft(userId: string): BookingDraft | null {
  const key = storageKey(userId);
  if (cache?.key !== key) cache = { key, draft: read(key) };
  return cache.draft;
}

export function setDraft(userId: string, draft: BookingDraft | null) {
  const key = storageKey(userId);
  cache = { key, draft };
  try {
    if (draft) window.sessionStorage.setItem(key, JSON.stringify(draft));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Still works for this page; only a reload loses it.
  }
  for (const listener of listeners) listener();
}

export function subscribeDraft(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
