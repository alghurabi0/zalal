"use client";

import { Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { PhotoGallery } from "@/components/live/photo-gallery";
import { Card } from "@/components/ui/card";
import { formatDuration } from "@/lib/booking/media";
import type { JobFile } from "@/lib/live/queries";

/**
 * Job progress's files (spec §5.14): before photos, clips, after photos.
 * Every refresh (a new file, a status change) brings freshly signed links;
 * each file keeps the first link it got, so a playing clip doesn't restart
 * and photos don't download again. The links last an hour.
 */
export function JobFiles({ files, done }: { files: JobFile[]; done: boolean }) {
  const t = useTranslations("LiveJob");
  const [links, setLinks] = useState<ReadonlyMap<string, string>>(() => linksOf(files, new Map()));
  const fresh = files.filter((file) => file.url && !links.has(file.id));
  // Adjusting state while rendering when new files arrive (React's pattern
  // for state derived from props), so new files show in this render.
  if (fresh.length > 0) setLinks(linksOf(fresh, links));
  const urlOf = (file: JobFile) => links.get(file.id) ?? file.url;

  if (files.length === 0) {
    return (
      <Card className="p-4 text-14 text-muted" data-testid="no-files">
        {done ? t("noFilesDone") : t("noFilesOpen")}
      </Card>
    );
  }

  const of = (kind: JobFile["kind"]) => files.filter((file) => file.kind === kind);
  const before = of("before");
  const clips = of("clip");
  const after = of("after");
  const photos = (list: JobFile[]) =>
    list.map((file, index) => ({
      id: file.id,
      url: urlOf(file),
      label: t("photo", { n: index + 1 }),
    }));

  return (
    <>
      {before.length > 0 && (
        <Section title={t("before")}>
          <PhotoGallery photos={photos(before)} missing={t("fileMissing")} />
        </Section>
      )}
      {clips.length > 0 && (
        <Section title={t("clips")}>
          <ul className="flex flex-col gap-2">
            {clips.map((clip, index) => {
              const url = urlOf(clip);
              return (
                <li key={clip.id} className="relative overflow-hidden rounded-20 bg-navy-2">
                  {url ? (
                    <video
                      src={url}
                      controls
                      playsInline
                      preload="metadata"
                      aria-label={t("clip", { n: index + 1 })}
                      className="aspect-video w-full object-contain"
                    />
                  ) : (
                    <span className="flex aspect-video items-center justify-center text-13 text-on-dark-muted">
                      {t("fileMissing")}
                    </span>
                  )}
                  <span className="pointer-events-none absolute start-3 top-3 flex items-center gap-1 rounded-8 bg-navy/75 px-2.5 py-0.5 text-13 font-extrabold text-white">
                    <Play aria-hidden className="size-3.5 fill-current" />
                    {t("clip", { n: index + 1 })}
                    {clip.durationS !== null && (
                      <span dir="ltr" className="ms-1 font-bold">
                        {formatDuration(clip.durationS)}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {after.length > 0 && (
        <Section title={t("after")}>
          <PhotoGallery photos={photos(after)} missing={t("fileMissing")} />
        </Section>
      )}
    </>
  );
}

function linksOf(files: JobFile[], known: ReadonlyMap<string, string>) {
  const next = new Map(known);
  for (const file of files) if (file.url && !next.has(file.id)) next.set(file.id, file.url);
  return next;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <h2 className="text-16 font-extrabold">{title}</h2>
      {children}
    </Card>
  );
}
