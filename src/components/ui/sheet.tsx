"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/cn";

import { SheetHandle } from "./sheet-panel";
import { useBackToClose } from "./use-back-to-close";

/**
 * Modal bottom sheet (address picker, cancel, reschedule). Radix Dialog
 * handles the focus trap, Esc and returning focus to the trigger. A tap
 * outside the sheet, a pull down and the phone's back button close it too
 * (closing cancels: nothing is saved), except while it is `busy` saving.
 *
 *   <Sheet>
 *     <SheetTrigger asChild><Button>…</Button></SheetTrigger>
 *     <SheetContent title="وين بيتك؟">…</SheetContent>
 *   </Sheet>
 *
 * Pass `open` and `onOpenChange` to Sheet to control it.
 */

type SheetContextValue = {
  close: () => void;
  /** Close, then open `href` in place of the sheet's history entry. */
  navigate: (href: string) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  isBusy: () => boolean;
};

const SheetContext = createContext<SheetContextValue | null>(null);

type SheetProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

export function Sheet({ open: openProp, defaultOpen = false, onOpenChange, children }: SheetProps) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;
  const [busy, setBusy] = useState(false);
  const busyNow = useRef(false);
  useEffect(() => {
    busyNow.current = busy;
  }, [busy]);

  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );
  const isBusy = useCallback(() => busyNow.current, []);
  const release = useBackToClose(open, () => setOpen(false), isBusy);

  const context: SheetContextValue = {
    close: () => setOpen(false),
    navigate: (href) => {
      release();
      setOpen(false);
      router.replace(href);
    },
    busy,
    setBusy,
    isBusy,
  };

  return (
    <SheetContext value={context}>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        {children}
      </Dialog.Root>
    </SheetContext>
  );
}

export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

type SheetContentProps = {
  /** Required: it names the dialog for screen readers. */
  title: ReactNode;
  description?: ReactNode;
  /** Saving: a tap outside, a pull down, Esc and back leave it open. */
  busy?: boolean;
  className?: string;
  children: ReactNode;
};

function useSheet() {
  const sheet = use(SheetContext);
  if (!sheet) throw new Error("Sheet parts must be inside Sheet");
  return sheet;
}

/**
 * Marks the sheet busy while `busy` is true, from any component inside it
 * (a form that owns its pending state). Undefined leaves it alone.
 */
export function useSheetBusy(busy: boolean | undefined) {
  const { setBusy } = useSheet();
  useEffect(() => {
    if (busy === undefined) return;
    setBusy(busy);
    return () => setBusy(false);
  }, [busy, setBusy]);
}

// A pull shorter than this is a tap or a scroll, not a drag.
const DRAG_SLOP = 8;
// Released past this share of the sheet's height, or flicked faster than
// FLICK px/ms, the sheet closes; otherwise it springs back.
const CLOSE_SHARE = 0.25;
const FLICK = 0.5;

export function SheetContent({
  title,
  description,
  busy: busyProp,
  className,
  children,
}: SheetContentProps) {
  const t = useTranslations("UI");
  const { close, navigate, busy, isBusy } = useSheet();
  useSheetBusy(busyProp);
  // Callers pass a new onOpenChange each render; the drag keeps its listeners.
  const latestClose = useRef(close);
  useEffect(() => {
    latestClose.current = close;
  });
  // A callback ref: the portal mounts the panel a render after this one.
  const panel = useCallback(
    (el: HTMLDivElement) => dragToClose(el, () => latestClose.current(), isBusy),
    [isBusy],
  );

  const stayWhileBusy = (event: Event) => {
    if (busy) event.preventDefault();
  };

  // Links inside the sheet replace its history entry, so back from the new
  // page goes to the page under the sheet (useBackToClose).
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest("a[href]");
    if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute("download")) {
      return;
    }
    const url = new URL(link.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  };

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-navy/40 data-[state=closed]:motion-safe:animate-fade-out data-[state=open]:motion-safe:animate-fade-in" />
      {/* The content box spans from 48px below the top to the bottom, so a
          tall sheet stops short of the top. Its empty part lets taps through
          to the overlay, which closes the sheet. Radix sets an inline
          pointer-events: auto on it, so the style here, not a class. */}
      <Dialog.Content
        // Without a description, Radix needs an explicit undefined here.
        {...(description ? {} : { "aria-describedby": undefined })}
        style={{ pointerEvents: "none" }}
        onInteractOutside={stayWhileBusy}
        onEscapeKeyDown={stayWhileBusy}
        className="fixed inset-x-0 top-12 bottom-0 z-50 flex flex-col justify-end data-[state=closed]:motion-safe:animate-sheet-out data-[state=open]:motion-safe:animate-sheet-in"
      >
        <div
          ref={panel}
          onClickCapture={onClickCapture}
          className={cn(
            "pointer-events-auto mx-auto flex max-h-full w-full max-w-phone flex-col gap-3 overflow-y-auto overscroll-y-contain rounded-t-sheet bg-surface px-5 pt-3.5 pb-safe-6 text-navy shadow-sheet",
            className,
          )}
        >
          <SheetHandle />
          <div className="flex flex-col">
            <Dialog.Title className="text-20 font-black">{title}</Dialog.Title>
            {description && (
              <Dialog.Description className="text-14 text-muted">{description}</Dialog.Description>
            )}
          </div>
          {children}
          {/* The canvas has no close button: a tap outside, a pull down,
              back, Esc and the screen reader's dismiss gesture close the
              sheet. This button is for keyboard and screen reader users and
              shows only when focused. */}
          <Dialog.Close
            disabled={busy}
            className="sr-only flex items-center justify-center gap-1 self-center text-14 font-bold text-teal focus:not-sr-only focus:min-h-11"
          >
            <X aria-hidden className="size-4" />
            {t("close")}
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

/**
 * Pull the sheet down to close it. Touch only (phones); a pull starts only
 * when the sheet and whatever scrolls under the finger are at their top,
 * so scrolling the content works as before. Returns the cleanup.
 */
function dragToClose(el: HTMLElement, close: () => void, isBusy: () => boolean) {
  let tracking = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let offset = 0;

  const moveTo = (y: number, animate: boolean) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.style.transition =
      animate && !reduce ? "transform 200ms cubic-bezier(0.32, 0.72, 0, 1)" : "";
    el.style.transform = y > 0 ? `translateY(${y}px)` : "";
  };

  const onStart = (event: TouchEvent) => {
    dragging = false;
    const touch = event.touches[0];
    tracking = event.touches.length === 1 && touch !== undefined && !isBusy();
    if (!tracking || !touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
  };

  const onMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!tracking || !touch) return;
    if (!dragging) {
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
      // Sideways, upwards or a scroll in progress: not ours.
      if (dy <= Math.abs(dx) || !event.cancelable || scrolledBelowTop(event.target, el)) {
        tracking = false;
        return;
      }
      dragging = true;
      startY = touch.clientY;
      startTime = event.timeStamp;
    }
    event.preventDefault();
    offset = Math.max(0, touch.clientY - startY);
    moveTo(offset, false);
  };

  const onEnd = (event: TouchEvent) => {
    tracking = false;
    if (!dragging) return;
    dragging = false;
    const speed = offset / Math.max(1, event.timeStamp - startTime);
    if (!isBusy() && (offset > el.offsetHeight * CLOSE_SHARE || speed > FLICK)) {
      // Stays where the finger left it; the exit animation carries it off.
      close();
    } else {
      moveTo(0, true);
    }
  };

  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("touchmove", onMove, { passive: false });
  el.addEventListener("touchend", onEnd);
  el.addEventListener("touchcancel", onEnd);
  return () => {
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", onEnd);
  };
}

/** Whether the panel or a scroller between the touch and it is scrolled down. */
function scrolledBelowTop(target: EventTarget | null, panel: HTMLElement) {
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    if (node.scrollTop > 0) return true;
    if (node === panel) return false;
  }
  return false;
}
