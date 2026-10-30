"use client";

import { Image as ImageIcon, type LucideIcon, Play, Video, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ChangeEvent, useEffect, useRef, useState } from "react";

import { Screen } from "@/components/layout/screen";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/input";
import { detailsComplete } from "@/lib/booking/draft";
import { formatBytes, formatDuration, MAX_BOOKING_FILES } from "@/lib/booking/media";
import type { AddProblem, UploadItem } from "@/lib/booking/uploads";
import { cn } from "@/lib/cn";
import { routes } from "@/lib/routes";
import { NOTE_MAX } from "@/lib/schemas/booking";

import { BookingHeader } from "./booking-header";
import { useBooking } from "./booking-provider";
import { BookingSkeleton } from "./booking-skeleton";

/**
 * Booking step 2 (Upload.dc.html, spec §5.10): optional photos and videos,
 * uploaded as soon as they're picked, and a note for the crew.
 */
export function PhotosStep() {
  const t = useTranslations("Upload");
  const router = useRouter();
  const { data, draft, update, uploads, addFiles } = useBooking();
  const videoInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<AddProblem[]>([]);

  const ready = draft !== null && detailsComplete(draft, data.days);
  // Step 1 isn't done (opened directly, or the slot was taken meanwhile).
  useEffect(() => {
    if (draft && !ready) router.replace(routes.book);
  }, [draft, ready, router]);
  if (!draft || !ready) return <BookingSkeleton />;

  const full = uploads.length >= MAX_BOOKING_FILES;
  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Lets the same file be picked again after it's removed.
    event.target.value = "";
    if (files.length === 0) return;
    setProblems([]);
    setProblems(await addFiles(files));
  };

  const problemText: Record<AddProblem, string> = {
    too_many: t("errors.tooMany", { max: MAX_BOOKING_FILES }),
    unsupported: t("errors.unsupported"),
    too_long: t("errors.tooLong"),
    too_big: t("errors.tooBig"),
    unreadable: t("errors.unreadable"),
  };

  return (
    <Screen className="bg-bg">
      <BookingHeader title={t("title")} step={t("step")} current={2} backHref={routes.book} />
      <div className="flex flex-1 flex-col gap-3.5 px-5 pt-1.5 pb-6">
        <p className="text-15 text-body-2">{t("intro")}</p>

        <div className="grid grid-cols-2 gap-2.5">
          <AddTile
            icon={Video}
            dark
            label={t("recordVideo")}
            disabled={full}
            onClick={() => videoInput.current?.click()}
          />
          <AddTile
            icon={ImageIcon}
            label={t("fromGallery")}
            disabled={full}
            onClick={() => galleryInput.current?.click()}
          />
        </div>
        {/* The tiles above are the controls; these only open the picker. */}
        <input
          ref={videoInput}
          type="file"
          accept="video/*"
          capture="environment"
          hidden
          onChange={pick}
        />
        <input
          ref={galleryInput}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={pick}
        />

        <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
          {full && <p className="text-13 text-muted">{t("limit", { max: MAX_BOOKING_FILES })}</p>}
          {[...new Set(problems)].map((problem) => (
            <p key={problem} className="text-14 font-bold text-danger">
              {problemText[problem]}
            </p>
          ))}
        </div>

        {uploads.length > 0 && (
          <ul aria-label={t("filesLabel")} className="flex flex-col gap-2">
            {uploads.map((item) => (
              <FileRow key={item.id} item={item} />
            ))}
          </ul>
        )}

        <Field label={t("noteLabel")} className="gap-1.5">
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={NOTE_MAX}
              value={draft.note}
              onChange={(event) => {
                const note = event.target.value;
                update((d) => ({ ...d, note }));
              }}
              placeholder={t("notePlaceholder")}
            />
          )}
        </Field>
      </div>
      <footer className="sticky bottom-0 z-10 flex gap-2.5 border-t border-border bg-surface px-5 pt-3 pb-safe-5.5">
        <Button href={routes.bookConfirm} size="footer" className="flex-1">
          {t("next")}
        </Button>
        <Button href={routes.bookConfirm} variant="link" size="footer">
          {t("skip")}
        </Button>
      </footer>
    </Screen>
  );
}

function AddTile({
  icon: Icon,
  label,
  dark = false,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  dark?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-27.5 flex-col items-center justify-center gap-1.5 rounded-card border-2 border-dashed bg-surface text-14 font-extrabold text-navy disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={cn(
          "flex size-11 items-center justify-center rounded-full",
          dark ? "bg-navy text-aqua" : "bg-selected text-teal",
        )}
      >
        <Icon aria-hidden className="size-5.5" strokeWidth={2} />
      </span>
      {label}
    </button>
  );
}

function FileRow({ item }: { item: UploadItem }) {
  const t = useTranslations("Upload");
  const { retryUpload, removeUpload } = useBooking();
  const name =
    item.kind === "video" ? t("videoName", { n: item.n }) : t("photoName", { n: item.n });
  const status =
    item.status === "done"
      ? t("uploaded")
      : item.status === "failed"
        ? t("failed")
        : item.status === "uploading"
          ? t("uploading", { percent: item.progress })
          : t("preparing");

  return (
    <li className="flex items-center gap-2.5 rounded-input border border-border bg-surface p-2.5">
      <span className="flex size-13 shrink-0 items-center justify-center rounded-10 bg-navy-2 text-aqua">
        {item.kind === "video" ? (
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
              item.status === "done"
                ? "text-ok-fg"
                : item.status === "failed"
                  ? "text-danger"
                  : "text-teal",
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
              item.status === "done" ? "bg-ok" : item.status === "failed" ? "bg-danger" : "bg-teal",
            )}
            style={{ width: `${item.progress}%` }}
          />
        </div>
        <span className="text-12 text-muted">
          {t(`kinds.${item.kind}`)}
          {item.durationS !== null && (
            <>
              {" · "}
              <span dir="ltr">{formatDuration(item.durationS)}</span>
            </>
          )}
          {" · "}
          <span dir="ltr">{formatBytes(item.bytes)}</span>
        </span>
      </div>
      {item.status === "failed" && (
        <Button
          variant="link"
          size="sm"
          className="px-1.5"
          aria-label={t("retryFile", { name })}
          onClick={() => retryUpload(item.id)}
        >
          {t("retry")}
        </Button>
      )}
      <IconButton
        icon={X}
        variant="soft"
        label={t("removeFile", { name })}
        onClick={() => removeUpload(item.id)}
      />
    </li>
  );
}
