"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Lightbox, type LightboxPhoto } from "@/components/ui/lightbox";
import type { CertificateFile } from "@/lib/certificates/queries";

/**
 * Report's two tiles (spec §5.15, Change): the first "قبل" and "بعد" photo,
 * each opening all photos of its kind full screen. A kind with no photos
 * shows "ما اكو صور" (photos are optional, decision 43–44).
 */
export function BeforeAfter({
  before,
  after,
}: {
  before: CertificateFile[];
  after: CertificateFile[];
}) {
  const t = useTranslations("Report");
  const [open, setOpen] = useState<{ kind: "before" | "after"; index: number } | null>(null);
  const photos = {
    before: toPhotos(before, (n) => `${t("before")} · ${t("photo", { n })}`),
    after: toPhotos(after, (n) => `${t("after")} · ${t("photo", { n })}`),
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {(["before", "after"] as const).map((kind) => {
          const first = photos[kind][0];
          const badge = (
            <span className="absolute start-2 top-2 rounded-8 bg-black/55 px-2 text-12 font-extrabold text-white">
              {t(kind)}
            </span>
          );
          return first ? (
            <button
              key={kind}
              type="button"
              onClick={() => setOpen({ kind, index: 0 })}
              aria-label={t(kind === "before" ? "beforePhotos" : "afterPhotos")}
              className="relative h-26 overflow-hidden rounded-button bg-navy-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            >
              {/* Signed links that expire: a plain img, not next/image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={first.url} alt="" className="size-full object-cover" />
              {badge}
              {photos[kind].length > 1 && (
                <span
                  aria-hidden
                  className="absolute end-2 bottom-2 rounded-8 bg-black/55 px-2 text-12 font-extrabold text-white"
                  dir="ltr"
                >
                  +{photos[kind].length - 1}
                </span>
              )}
            </button>
          ) : (
            <div
              key={kind}
              className="relative flex h-26 items-center justify-center rounded-button bg-well text-13 font-bold text-muted"
            >
              {badge}
              {t("noPhotos")}
            </div>
          );
        })}
      </div>
      <Lightbox
        photos={open ? photos[open.kind] : []}
        index={open?.index ?? null}
        onIndexChange={(index) => setOpen(open && index !== null ? { ...open, index } : null)}
      />
    </>
  );
}

function toPhotos(files: CertificateFile[], label: (n: number) => string): LightboxPhoto[] {
  const photos: LightboxPhoto[] = [];
  for (const file of files) {
    if (file.mediaType !== "photo" || !file.url) continue;
    photos.push({ id: file.id, url: file.url, label: label(photos.length + 1) });
  }
  return photos;
}
