"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Lightbox, type LightboxPhoto } from "@/components/ui/lightbox";

export type GalleryPhoto = { id: string; url: string | null; label: string };

/**
 * A grid of photos that open full screen (Job progress, spec §5.14). The
 * links are signed for an hour, so plain <img> rather than next/image,
 * which would cache them on the server.
 */
export function PhotoGallery({ photos, missing }: { photos: GalleryPhoto[]; missing: string }) {
  const t = useTranslations("LiveJob");
  const [open, setOpen] = useState<number | null>(null);
  const shown = photos.filter((photo): photo is LightboxPhoto => photo.url !== null);

  return (
    <>
      <ul className="grid grid-cols-3 gap-2">
        {photos.map((photo) => (
          <li key={photo.id} className="aspect-square overflow-hidden rounded-chip bg-well">
            {photo.url ? (
              <button
                type="button"
                onClick={() => setOpen(shown.findIndex((p) => p.id === photo.id))}
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
      <Lightbox photos={shown} index={open} onIndexChange={setOpen} />
    </>
  );
}
