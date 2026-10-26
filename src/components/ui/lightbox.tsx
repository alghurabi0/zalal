"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import type { KeyboardEvent } from "react";

export type LightboxPhoto = { id: string; url: string; label: string };

type LightboxProps = {
  photos: LightboxPhoto[];
  /** The photo shown; null when closed. */
  index: number | null;
  onIndexChange: (index: number | null) => void;
};

/**
 * Photos full screen over a dark overlay (Job progress, Report), with
 * previous/next when there are several. Arrow keys move too; in RTL the
 * left arrow goes forward. Signed links expire, so a plain <img>.
 */
export function Lightbox({ photos, index, onIndexChange }: LightboxProps) {
  const t = useTranslations("UI");
  const photo = index === null ? null : (photos[index] ?? null);
  const many = photos.length > 1;
  const go = (step: number) => {
    if (index === null) return;
    onIndexChange((index + step + photos.length) % photos.length);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!many) return;
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    if (event.key === "ArrowLeft") go(rtl ? 1 : -1);
    if (event.key === "ArrowRight") go(rtl ? -1 : 1);
  };

  return (
    <Dialog.Root open={photo !== null} onOpenChange={(open) => !open && onIndexChange(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/90 data-[state=open]:motion-safe:animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-50 mx-auto flex max-w-phone flex-col gap-3 px-4 pt-4 pb-safe-4"
        >
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title className="text-16 font-extrabold text-white">
              {photo?.label}
              {many && index !== null && (
                <span className="ms-2 text-13 font-bold text-on-dark-muted">
                  {t("photoOf", { n: index + 1, total: photos.length })}
                </span>
              )}
            </Dialog.Title>
            <Dialog.Close
              aria-label={t("close")}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/90 text-navy"
            >
              <X aria-hidden className="size-5" />
            </Dialog.Close>
          </div>
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.url} alt={photo.label} className="min-h-0 flex-1 object-contain" />
          )}
          {many && (
            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label={t("previousPhoto")}
                className="flex size-11 items-center justify-center rounded-full bg-white/90 text-navy"
              >
                <ChevronLeft aria-hidden className="size-5 rtl:-scale-x-100" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label={t("nextPhoto")}
                className="flex size-11 items-center justify-center rounded-full bg-white/90 text-navy"
              >
                <ChevronRight aria-hidden className="size-5 rtl:-scale-x-100" />
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
