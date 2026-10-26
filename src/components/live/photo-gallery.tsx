"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useState } from "react";

export type GalleryPhoto = { id: string; url: string | null; label: string };

/**
 * A grid of photos that open full screen (Job progress, spec §5.14). The
 * links are signed for an hour, so plain <img> rather than next/image,
 * which would cache them on the server.
 */
export function PhotoGallery({ photos, missing }: { photos: GalleryPhoto[]; missing: string }) {
  const t = useTranslations("LiveJob");
  const tUI = useTranslations("UI");
  const [open, setOpen] = useState<GalleryPhoto | null>(null);

  return (
    <>
      <ul className="grid grid-cols-3 gap-2">
        {photos.map((photo) => (
          <li key={photo.id} className="aspect-square overflow-hidden rounded-chip bg-well">
            {photo.url ? (
              <button
                type="button"
                onClick={() => setOpen(photo)}
                aria-label={t("openPhoto", { label: photo.label })}
                className="block size-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="" className="size-full object-cover" />
              </button>
            ) : (
              <span className="flex size-full items-center justify-center p-1 text-center text-11 text-muted">
                {missing}
              </span>
            )}
          </li>
        ))}
      </ul>
      <Dialog.Root open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/90 data-[state=open]:motion-safe:animate-fade-in" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-50 mx-auto flex max-w-phone flex-col gap-3 px-4 pt-4 pb-safe-4"
          >
            <div className="flex items-center justify-between gap-3">
              <Dialog.Title className="text-16 font-extrabold text-white">{open?.label}</Dialog.Title>
              <Dialog.Close
                aria-label={tUI("close")}
                className="flex size-11 items-center justify-center rounded-full bg-white/90 text-navy"
              >
                <X aria-hidden className="size-5" />
              </Dialog.Close>
            </div>
            {open?.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={open.url} alt={open.label} className="min-h-0 flex-1 object-contain" />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
