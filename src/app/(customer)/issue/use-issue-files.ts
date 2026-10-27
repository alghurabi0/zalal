"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Upload } from "tus-js-client";

import { contentTypeOf, type MediaKind, mediaKindOf } from "@/lib/booking/media";
import type { AddProblem } from "@/lib/booking/uploads";
import { checkVideo, shrinkPhoto } from "@/lib/media/prepare";
import { createTusUpload } from "@/lib/media/tus";
import { createClient } from "@/lib/supabase/browser";
import { MAX_TICKET_FILES, TICKET_MEDIA_BUCKET, ticketObjectPath } from "@/lib/tickets/media";

// The Issue report's files (spec §5.17): checked and shrunk like Upload's,
// then uploaded at once over TUS to ticket-media/<user id>/. Kept in the
// form's own state: a report is sent in one sitting, so nothing survives a
// reload (an unattached file is deleted by the nightly cleanup).

export type IssueFileStatus = "preparing" | "uploading" | "done" | "failed";

export type IssueFile = {
  id: string;
  kind: MediaKind;
  path: string;
  durationS: number | null;
  status: IssueFileStatus;
  /** 0–100. */
  progress: number;
  /** A local preview of a photo (object URL). */
  previewUrl: string | null;
};

type Job = { file: File; contentType: string; upload?: Upload };

export function useIssueFiles(userId: string) {
  const [files, setFiles] = useState<IssueFile[]>([]);
  const jobs = useRef(new Map<string, Job>());
  const count = useRef(0);

  const patch = useCallback((id: string, changes: Partial<IssueFile>) => {
    setFiles((current) => current.map((file) => (file.id === id ? { ...file, ...changes } : file)));
  }, []);

  const start = useCallback(
    async (id: string, path: string) => {
      const job = jobs.current.get(id);
      if (!job) return;
      try {
        const upload = await createTusUpload(
          job.file,
          { path, contentType: job.contentType, bucket: TICKET_MEDIA_BUCKET },
          {
            onProgress: (progress) => patch(id, { progress }),
            onSuccess: () => {
              if (jobs.current.has(id)) patch(id, { status: "done", progress: 100 });
            },
            onError: () => {
              if (jobs.current.has(id)) patch(id, { status: "failed" });
            },
          },
        );
        job.upload = upload;
        if (jobs.current.get(id) === job) upload.start();
      } catch {
        // The library didn't load (offline) or the upload couldn't start.
        if (jobs.current.has(id)) patch(id, { status: "failed" });
      }
    },
    [patch],
  );

  /** Checks the picked files, adds the ones that fit and starts uploading them. */
  const add = useCallback(
    async (picked: File[]): Promise<AddProblem[]> => {
      const problems: AddProblem[] = [];
      const supported = picked.flatMap((file) => {
        const contentType = contentTypeOf(file);
        if (contentType) return [{ file, contentType }];
        problems.push("unsupported");
        return [];
      });
      const room = MAX_TICKET_FILES - count.current;
      if (supported.length > room) problems.push("too_many");

      await Promise.all(
        supported.slice(0, Math.max(room, 0)).map(async ({ file, contentType }) => {
          const kind = mediaKindOf(contentType);
          const id = crypto.randomUUID();
          const path = ticketObjectPath(userId, id, contentType);
          count.current += 1;
          setFiles((current) => [
            ...current,
            {
              id,
              kind,
              path,
              durationS: null,
              status: "preparing",
              progress: 0,
              previewUrl: null,
            },
          ]);
          const prepared = kind === "video" ? await checkVideo(file) : await shrinkPhoto(file);
          if ("problem" in prepared) {
            problems.push(prepared.problem);
            count.current -= 1;
            setFiles((current) => current.filter((item) => item.id !== id));
            return;
          }
          jobs.current.set(id, { file: prepared.file, contentType });
          patch(id, {
            durationS: prepared.durationS,
            status: "uploading",
            previewUrl: kind === "photo" ? URL.createObjectURL(prepared.file) : null,
          });
          void start(id, path);
        }),
      );
      return problems;
    },
    [patch, start, userId],
  );

  const retry = useCallback(
    (file: IssueFile) => {
      const job = jobs.current.get(file.id);
      if (!job) return;
      patch(file.id, { status: "uploading" });
      if (job.upload) job.upload.start();
      else void start(file.id, file.path);
    },
    [patch, start],
  );

  /** The ×: stops the upload, or deletes the finished file from Storage. */
  const remove = useCallback((file: IssueFile) => {
    const job = jobs.current.get(file.id);
    jobs.current.delete(file.id);
    count.current = Math.max(0, count.current - 1);
    if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
    setFiles((current) => current.filter((item) => item.id !== file.id));
    if (job?.upload && file.status !== "done") {
      void job.upload.abort(true).catch(() => undefined);
    } else if (file.status === "done") {
      // Best effort: an unattached file left behind is deleted by the cleanup.
      void createClient()
        .storage.from(TICKET_MEDIA_BUCKET)
        .remove([file.path])
        .catch(() => undefined);
    }
  }, []);

  /** After the report is sent: the files belong to the ticket now. */
  const forget = useCallback(() => {
    jobs.current.clear();
  }, []);

  // Previews are freed when the form goes away.
  const latest = useRef(files);
  useEffect(() => {
    latest.current = files;
  }, [files]);
  useEffect(
    () => () => {
      for (const file of latest.current) if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
    },
    [],
  );

  return { files, add, retry, remove, forget };
}
