"use client";

import { Camera, Image as ImageIcon, Play, Video, WifiOff, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ChangeEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { formatBytes, formatDuration } from "@/lib/booking/media";
import { cn } from "@/lib/cn";
import {
  canRemoveJobMedia,
  captureKinds,
  JOB_MEDIA_KINDS,
  JOB_MEDIA_LIMITS,
  type JobMediaKind,
} from "@/lib/crew/media";
import { type AddProblem, isPending, type QueueItem } from "@/lib/crew/media-queue";
import type { CrewMedia } from "@/lib/crew/queries";
import { mediaQueue } from "@/lib/crew/use-media-queue";
import type { OrderStatus } from "@/lib/orders/status";
import { useOnline } from "@/lib/use-online";

import { removeJobMedia } from "../../actions";
import { useCrewMedia } from "../../use-crew-media";

/**
 * C3b (spec §8.1): before and after photos and clips, all optional. Each is
 * taken with the phone's camera, queued on the phone (IndexedDB) and sent
 * in the background, so it survives no signal and a reload. Attached files
 * come from the server; queued ones from the queue until they arrive.
 */
export function JobMedia({
  userId,
  orderId,
  crewId,
  status,
  files,
}: {
  userId: string;
  orderId: string;
  crewId: string;
  status: OrderStatus;
  files: CrewMedia[];
}) {
  const t = useTranslations("Crew.media");
  const router = useRouter();
  const all = useCrewMedia(userId);
  const online = useOnline();

  const attachedPaths = useMemo(() => new Set(files.map((file) => file.path)), [files]);
  const queued = all.filter(
    (item) =>
      item.orderId === orderId && !(item.status === "attached" && attachedPaths.has(item.path)),
  );

  // A file arrived: show it from the server, then let the queue forget it.
  useEffect(() => mediaQueue().dropAttached(attachedPaths), [attachedPaths]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = mediaQueue().onAttached((item) => {
      if (item.orderId !== orderId) return;
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 500);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [orderId, router]);

  const canTake = captureKinds(status);
  const kinds = JOB_MEDIA_KINDS.filter(
    (kind) =>
      canTake.includes(kind) ||
      files.some((file) => file.kind === kind) ||
      queued.some((item) => item.kind === kind),
  );
  if (kinds.length === 0) return null;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <p className="text-14 text-body-2">{t("hint")}</p>
      {!online && queued.some(isPending) && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-chip bg-warn-bg px-3 py-2 text-14 font-bold text-warn-fg"
        >
          <WifiOff aria-hidden className="size-4.5 shrink-0" />
          {t("offline")}
        </p>
      )}
      {kinds.map((kind) => (
        <KindSection
          key={kind}
          kind={kind}
          userId={userId}
          orderId={orderId}
          crewId={crewId}
          canTake={canTake.includes(kind)}
          canRemove={canRemoveJobMedia(status)}
          online={online}
          files={files.filter((file) => file.kind === kind)}
          queued={queued.filter((item) => item.kind === kind)}
        />
      ))}
    </Card>
  );
}

function KindSection({
  kind,
  userId,
  orderId,
  crewId,
  canTake,
  canRemove,
  online,
  files,
  queued,
}: {
  kind: JobMediaKind;
  userId: string;
  orderId: string;
  crewId: string;
  canTake: boolean;
  canRemove: boolean;
  online: boolean;
  files: CrewMedia[];
  queued: QueueItem[];
}) {
  const t = useTranslations("Crew.media");
  const input = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<AddProblem[]>([]);
  const limit = JOB_MEDIA_LIMITS[kind];
  // Failed files don't hold a place: they are removed or retried.
  const used = files.length + queued.filter((item) => item.status !== "failed").length;
  const room = limit - used;
  const name = (n: number) => (kind === "clip" ? t("clip", { n }) : t("photo", { n }));
  const headingId = `job-media-${kind}`;

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    // Lets the same file be picked again.
    event.target.value = "";
    if (picked.length === 0) return;
    setProblems([]);
    setProblems(await mediaQueue().add(userId, { crewId, orderId, kind, room }, picked));
  };

  const problemText: Record<AddProblem, string> = {
    too_many: t("problems.too_many", { max: limit }),
    unsupported: t("problems.unsupported"),
    too_long: t("problems.too_long"),
    too_big: t("problems.too_big"),
    unreadable: t("problems.unreadable"),
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-16 font-extrabold">
          {t(`sections.${kind}`)}
        </h2>
        {canTake && room > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5 px-3"
            aria-label={t(`captureLabel.${kind}`)}
            onClick={() => input.current?.click()}
          >
            {kind === "clip" ? (
              <Video aria-hidden className="size-4.5" />
            ) : (
              <Camera aria-hidden className="size-4.5" />
            )}
            {t(`capture.${kind}`)}
          </Button>
        )}
        {canTake && room <= 0 && (
          <span className="text-13 text-muted">{t("full", { max: limit })}</span>
        )}
      </div>
      {/* The button above is the control; this only opens the camera. */}
      <input
        ref={input}
        type="file"
        accept={kind === "clip" ? "video/*" : "image/*"}
        capture="environment"
        hidden
        data-testid={`capture-${kind}`}
        onChange={pick}
      />
      <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
        {[...new Set(problems)].map((problem) => (
          <p key={problem} className="text-14 font-bold text-danger">
            {problemText[problem]}
          </p>
        ))}
      </div>
      {files.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {files.map((file, index) => (
            <AttachedTile
              key={file.id}
              file={file}
              orderId={orderId}
              name={name(index + 1)}
              // remove_job_media takes back only this crew's own files.
              canRemove={canRemove && file.path.startsWith(`crew/${crewId}/`)}
            />
          ))}
        </ul>
      )}
      {queued.length > 0 && (
        <ul className="flex flex-col gap-2">
          {queued.map((item, index) => (
            <QueuedRow
              key={item.id}
              item={item}
              userId={userId}
              online={online}
              name={name(files.length + index + 1)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AttachedTile({
  file,
  orderId,
  name,
  canRemove,
}: {
  file: CrewMedia;
  orderId: string;
  name: string;
  canRemove: boolean;
}) {
  const t = useTranslations("Crew.media");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const remove = () =>
    startTransition(async () => {
      setFailed(false);
      try {
        const result = await removeJobMedia({ orderId, mediaId: file.id });
        if (result.status === "done" || result.error === "not_found") router.refresh();
        else setFailed(true);
      } catch {
        setFailed(true);
      }
    });

  return (
    <li className="relative flex flex-col gap-1">
      <div className="aspect-square overflow-hidden rounded-chip bg-well">
        {!file.url ? (
          <span className="flex size-full items-center justify-center p-1 text-center text-11 text-muted">
            {t("missing")}
          </span>
        ) : file.mediaType === "photo" ? (
          <a href={file.url} target="_blank" rel="noreferrer" className="block size-full">
            {/* Signed links that expire in an hour: next/image would cache
                them on the server, so a plain img. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={file.url} alt={name} className="size-full object-cover" />
          </a>
        ) : (
          <video
            src={file.url}
            controls
            preload="metadata"
            aria-label={name}
            className="size-full bg-navy object-cover"
          />
        )}
      </div>
      {canRemove && (
        <IconButton
          icon={X}
          variant="floating"
          label={t("remove", { name })}
          disabled={pending}
          onClick={remove}
          className="absolute end-1 top-1"
        />
      )}
      {failed && (
        <p role="alert" className="text-12 font-bold text-danger">
          {t("removeFailed")}
        </p>
      )}
    </li>
  );
}

function QueuedRow({
  item,
  userId,
  online,
  name,
}: {
  item: QueueItem;
  userId: string;
  online: boolean;
  name: string;
}) {
  const t = useTranslations("Crew.media");
  const preview = usePreview(item.kind === "clip" ? null : item.file);
  const failed = item.status === "failed";
  const status = failed
    ? t("status.failed")
    : item.status === "uploading"
      ? t("status.uploading", { percent: item.progress })
      : item.status === "waiting" && !online
        ? t("status.offline")
        : t(`status.${item.status}`);
  // Retrying helps only when Storage refused the file; the other errors stay.
  const canRetry = failed && item.error === "upload_refused";

  return (
    <li className="flex items-center gap-2.5 rounded-input border border-border bg-surface p-2.5">
      <span className="flex size-13 shrink-0 items-center justify-center overflow-hidden rounded-10 bg-navy-2 text-aqua">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="size-full object-cover" />
        ) : item.kind === "clip" ? (
          <Play aria-hidden className="size-5" fill="currentColor" strokeWidth={0} />
        ) : (
          <ImageIcon aria-hidden className="size-5" strokeWidth={2} />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-14 font-extrabold">{name}</span>
          <span
            className={cn(
              "text-12 font-bold",
              item.status === "attached" ? "text-ok-fg" : failed ? "text-danger" : "text-teal",
            )}
          >
            {status}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={name}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={item.progress}
          className="flex h-1.5 overflow-hidden rounded-full bg-border"
        >
          <div
            className={cn(
              "rounded-full motion-safe:transition-all",
              item.status === "attached" ? "bg-ok" : failed ? "bg-danger" : "bg-teal",
            )}
            style={{ width: `${item.progress}%` }}
          />
        </div>
        {failed && item.error ? (
          <span className="text-12 font-bold text-danger">{t(`errors.${item.error}`)}</span>
        ) : (
          <span className="text-12 text-muted">
            {item.durationS !== null && (
              <>
                <span dir="ltr">{formatDuration(item.durationS)}</span>
                {" · "}
              </>
            )}
            <span dir="ltr">{formatBytes(item.bytes)}</span>
          </span>
        )}
      </div>
      {canRetry && (
        <Button
          variant="link"
          size="sm"
          className="px-1.5"
          aria-label={t("retryFile", { name })}
          onClick={() => mediaQueue().retry(userId, item.id)}
        >
          {t("retry")}
        </Button>
      )}
      {/* Attaching can't be called back; once attached, the tile has its own ×. */}
      {item.status !== "attached" && item.status !== "attaching" && (
        <IconButton
          icon={X}
          variant="soft"
          label={t("remove", { name })}
          onClick={() => void mediaQueue().remove(userId, item.id)}
        />
      )}
    </li>
  );
}

/** A temporary link to a queued photo, released when the row goes. */
function usePreview(file: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    const link = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the link must be made and released with the row.
    setUrl(link);
    return () => {
      URL.revokeObjectURL(link);
      setUrl(null);
    };
  }, [file]);
  return url;
}
