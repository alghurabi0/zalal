"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Lightbox, type LightboxPhoto } from "@/components/ui/lightbox";

/** The photo lightbox, with the brand images standing in for job photos. */
export function LightboxDemo() {
  const t = useTranslations("Kit");
  const [open, setOpen] = useState<number | null>(null);
  const photos: LightboxPhoto[] = [
    { id: "1", url: "/brand/logo-tile.svg", label: t("photo", { n: 1 }) },
    { id: "2", url: "/brand/logo.svg", label: t("photo", { n: 2 }) },
  ];
  return (
    <>
      <ul className="grid grid-cols-3 gap-2">
        {photos.map((photo, index) => (
          <li key={photo.id} className="aspect-square overflow-hidden rounded-chip bg-navy">
            <button
              type="button"
              onClick={() => setOpen(index)}
              aria-label={t("openPhoto", { label: photo.label })}
              className="block size-full p-3"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="size-full object-contain" />
            </button>
          </li>
        ))}
      </ul>
      <Lightbox photos={photos} index={open} onIndexChange={setOpen} />
    </>
  );
}
