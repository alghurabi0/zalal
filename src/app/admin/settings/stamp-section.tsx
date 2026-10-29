"use client";

import { ImagePlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AdminSettings } from "@/lib/admin/catalog-queries";
import type { AdminEditError } from "@/lib/admin/edit-errors";
import { cn } from "@/lib/cn";
import { PUBLIC_CONTENT_MAX_BYTES, toWebp } from "@/lib/media/to-webp";
import { createClient } from "@/lib/supabase/browser";

import { saveStamp } from "./actions";

/** Printed about 4 cm wide; this keeps it sharp at print resolution. */
const STAMP_MAX_EDGE = 800;

type Status = "uploading" | "saved" | "removed" | "too_big" | "failed" | AdminEditError | null;

/**
 * A13's certificate stamp (spec §10.1): picked, scaled to WebP (transparency
 * kept), uploaded to public-content/stamp/ with the admin's session and saved
 * at once; the replaced stamp is deleted. Unlike the other sections it has
 * no Save button: each pick or removal is the change.
 */
export function StampSection({ settings }: { settings: AdminSettings }) {
  const t = useTranslations("Admin.settings.stamp");
  const tErrors = useTranslations("Admin.editErrors");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const hintId = useId();
  const [status, setStatus] = useState<Status>(null);
  const path = settings.certificate_stamp_path;
  const url = path
    ? createClient().storage.from("public-content").getPublicUrl(path).data.publicUrl
    : null;
  const busy = status === "uploading";

  const save = async (next: string | null) => {
    const result = await saveStamp({ path: next });
    if (result.status === "error") {
      setStatus(result.error);
      return;
    }
    setStatus(next ? "saved" : "removed");
    router.refresh();
  };

  const pick = async (file: File) => {
    setStatus("uploading");
    try {
      const webp = await toWebp(file, STAMP_MAX_EDGE);
      if (webp.size > PUBLIC_CONTENT_MAX_BYTES) {
        setStatus("too_big");
        return;
      }
      const next = `stamp/${crypto.randomUUID()}.webp`;
      const { error } = await createClient()
        .storage.from("public-content")
        .upload(next, webp, { contentType: "image/webp" });
      if (error) {
        setStatus("failed");
        return;
      }
      await save(next);
    } catch {
      setStatus("failed");
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const problem =
    status === "too_big"
      ? t("tooBig")
      : status === "failed"
        ? t("failed")
        : status && status !== "uploading" && status !== "saved" && status !== "removed"
          ? tErrors(status)
          : null;

  return (
    <Card>
      <section aria-labelledby={headingId} className="flex flex-col gap-4 p-4">
        <h2 id={headingId} className="text-16 font-extrabold">
          {t("title")}
        </h2>
        <p className="text-13 text-muted">{t("body")}</p>
        {url ? (
          // A public file; a plain <img> keeps it simple.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={t("preview")}
            className="h-32 w-full rounded-card border border-border bg-surface object-contain p-2"
          />
        ) : (
          <div className="flex h-32 w-full flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed bg-surface p-2 text-center text-13 text-muted">
            <ImagePlus aria-hidden className="size-7 text-teal" />
            {t("empty")}
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void pick(file);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={busy}
            aria-describedby={hintId}
            onClick={() => input.current?.click()}
          >
            {url ? t("replace") : t("add")}
          </Button>
          {url && (
            <Button
              type="button"
              variant="link"
              size="sm"
              disabled={busy}
              onClick={() => void save(null)}
            >
              <X aria-hidden className="size-4" />
              {t("remove")}
            </Button>
          )}
        </div>
        <p
          id={hintId}
          role="status"
          className={cn("text-13 font-bold", problem ? "text-danger" : "text-ok-fg")}
        >
          {busy
            ? t("uploading")
            : (problem ??
              (status === "saved" ? t("saved") : status === "removed" ? t("removed") : null))}
        </p>
      </section>
    </Card>
  );
}
