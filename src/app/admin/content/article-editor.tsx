"use client";

import { ExternalLink, ImagePlus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition } from "react";

import { MarkdownText } from "@/components/articles/markdown";
import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { AdminArticle, ArticleStatus } from "@/lib/admin/content-queries";
import type { AdminEditError } from "@/lib/admin/edit-errors";
import { readMinutes } from "@/lib/articles/read-time";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { PUBLIC_CONTENT_MAX_BYTES, toWebp } from "@/lib/media/to-webp";
import { routes } from "@/lib/routes";
import {
  articleTitleSchema,
  BODY_MAX,
  SLUG_MAX,
  slugSchema,
  TITLE_MAX,
} from "@/lib/schemas/article";
import { createClient } from "@/lib/supabase/browser";

import { deleteArticle, discardCover, saveArticle } from "./actions";
import { ArticleStatusBadge } from "./status-badge";

const COVER_MAX_EDGE = 1600;

type Cover = { path: string; url: string; uploaded: boolean } | null;

/**
 * A11's editor (spec §8.2): title, Latin slug (fixed once published),
 * category, featured, cover (scaled to WebP in the browser and uploaded to
 * public-content/articles/ with the admin's session), and the Markdown body
 * with a live preview and read time. Drafts save as drafts; publishing and
 * moving back to draft are their own buttons.
 */
export function ArticleEditor({
  article,
  categories,
}: {
  article: AdminArticle | null;
  categories: { id: number; name: string }[];
}) {
  const t = useTranslations("Admin.content.editor");
  const tErrors = useTranslations("Admin.editErrors");
  const router = useRouter();
  const edit = useAdminEdit();
  const [title, setTitle] = useState(article?.title ?? "");
  const [slug, setSlug] = useState(article?.slug ?? "");
  const [categoryId, setCategoryId] = useState(article?.categoryId ?? categories[0]?.id ?? 0);
  const [featured, setFeatured] = useState(article?.featured ?? false);
  const [cover, setCover] = useState<Cover>(
    article?.coverPath && article.coverUrl
      ? { path: article.coverPath, url: article.coverUrl, uploaded: false }
      : null,
  );
  const [body, setBody] = useState(article?.body ?? "");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [notice, setNotice] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  // Publishing also needs a body; a draft doesn't.
  const [triedPublish, setTriedPublish] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<AdminEditError | null>(null);
  const tabsId = useId();

  const status: ArticleStatus = article?.status ?? "draft";
  const slugLocked = Boolean(article?.publishedAt);
  const titleOk = articleTitleSchema.safeParse(title).success;
  const slugOk = slugSchema.safeParse(slug).success;
  const bodyTooLong = body.length > BODY_MAX;

  const save = (next: ArticleStatus) => {
    setTried(true);
    setTriedPublish(next === "published");
    setNotice(null);
    const bodyMissing = next === "published" && !/\S/.test(body);
    if (!titleOk || !slugOk || bodyTooLong || bodyMissing || !categoryId) return;
    edit.run(
      () =>
        saveArticle({
          id: article?.id ?? null,
          slug,
          title,
          categoryId,
          coverPath: cover?.path ?? null,
          body,
          featured,
          status: next,
        }),
      (result) => {
        setCover((current) => current && { ...current, uploaded: false });
        if (!article) {
          // Next keeps this page alive: the next "مقال جديد" must start empty.
          setTitle("");
          setSlug("");
          setBody("");
          setFeatured(false);
          setCover(null);
          setTried(false);
          setTriedPublish(false);
          setTab("write");
          router.replace(routes.adminArticle(result.id));
          return;
        }
        setNotice(
          next === status
            ? t("saved")
            : next === "published"
              ? t("publishedDone")
              : t("unpublishedDone"),
        );
      },
    );
  };

  const publishMissingBody = triedPublish && !/\S/.test(body);

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        save(status);
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <ArticleStatusBadge status={status} />
        {article?.publishedAt && (
          <span className="text-13 text-muted">
            {t("publishedOn", { date: formatDate(article.publishedAt) })}
          </span>
        )}
        {article && status === "published" && (
          <Link
            href={routes.article(article.slug)}
            target="_blank"
            className="inline-flex min-h-11 items-center gap-1.5 text-14 font-bold text-teal hover:text-navy"
          >
            {t("view")}
            <ExternalLink aria-hidden className="size-4" />
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Field
            label={t("title")}
            variant="compact"
            error={tried && !titleOk ? t("titleRange", { max: TITLE_MAX }) : undefined}
          >
            {(control) => (
              <Input
                {...control}
                variant="compact"
                value={title}
                maxLength={TITLE_MAX + 10}
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
          </Field>

          <Field
            label={t("slug")}
            variant="compact"
            hint={slugLocked ? t("slugLocked") : t("slugHint")}
            error={tried && !slugOk ? t("slugInvalid", { max: SLUG_MAX }) : undefined}
          >
            {(control) => (
              <Input
                {...control}
                variant="compact"
                dir="ltr"
                value={slug}
                readOnly={slugLocked}
                maxLength={SLUG_MAX}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={cn("text-start", slugLocked && "bg-bg text-muted")}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
              />
            )}
          </Field>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <span id={`${tabsId}-label`} className="text-13 font-bold">
                {t("body")}
              </span>
              <div
                role="tablist"
                aria-labelledby={`${tabsId}-label`}
                className="grid grid-cols-2 rounded-input bg-border p-1"
              >
                {(["write", "preview"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    id={`${tabsId}-${key}`}
                    aria-selected={tab === key}
                    aria-controls={`${tabsId}-${key}-panel`}
                    onClick={() => setTab(key)}
                    className={cn(
                      "flex min-h-11 items-center justify-center rounded-10 px-4 text-14 font-extrabold focus-visible:outline-2 focus-visible:outline-teal",
                      tab === key ? "bg-surface text-navy shadow-segment" : "text-muted",
                    )}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
            <div
              role="tabpanel"
              id={`${tabsId}-write-panel`}
              aria-labelledby={`${tabsId}-write`}
              hidden={tab !== "write"}
            >
              <Field
                label={<span className="sr-only">{t("body")}</span>}
                variant="compact"
                hint={t("bodyHint")}
                error={
                  bodyTooLong
                    ? t("bodyTooLong", { max: BODY_MAX })
                    : publishMissingBody
                      ? t("bodyRequired")
                      : undefined
                }
              >
                {(control) => (
                  <Textarea
                    {...control}
                    rows={18}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    className="min-h-80 resize-y text-15 leading-body"
                  />
                )}
              </Field>
            </div>
            <div
              role="tabpanel"
              id={`${tabsId}-preview-panel`}
              aria-labelledby={`${tabsId}-preview`}
              hidden={tab !== "preview"}
            >
              <Card className="min-h-80 max-w-phone p-5">
                {/\S/.test(body) ? (
                  <MarkdownText>{body}</MarkdownText>
                ) : (
                  <p className="text-15 text-muted">{t("previewEmpty")}</p>
                )}
              </Card>
            </div>
            <span className="text-13 text-muted">
              {t("readTime", { minutes: readMinutes(body) })}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:w-72 lg:shrink-0">
          <Field label={t("category")} variant="compact">
            {(control) => (
              <Select
                {...control}
                variant="compact"
                value={categoryId}
                onChange={(event) => setCategoryId(Number(event.target.value))}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <label className="flex min-h-11 items-start gap-2.5 text-14 font-bold">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-navy"
              checked={featured}
              onChange={(event) => setFeatured(event.target.checked)}
            />
            {t("featured")}
          </label>

          <CoverPicker cover={cover} onChange={setCover} />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-divider pt-4">
        <p role="status" className={cn("text-14 font-bold text-ok-fg", !notice && "sr-only")}>
          {notice}
        </p>
        {edit.error && (
          <p role="alert" className="text-14 font-bold text-danger">
            {tErrors(edit.error)}
          </p>
        )}
        {publishMissingBody && (
          <p role="alert" className="text-14 font-bold text-danger">
            {t("bodyRequired")}
          </p>
        )}
        {categories.length === 0 && (
          <p role="alert" className="text-14 font-bold text-danger">
            {t("noCategories")}{" "}
            <Link href={routes.adminCategories} className="text-teal underline">
              {t("addCategory")}
            </Link>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {status === "draft" ? (
            <>
              <Button
                type="button"
                size="sm"
                loading={edit.pending}
                onClick={() => save("published")}
              >
                {t("publish")}
              </Button>
              <Button type="submit" variant="secondary" size="sm" disabled={edit.pending}>
                {t("saveDraft")}
              </Button>
            </>
          ) : (
            <>
              <Button type="submit" size="sm" loading={edit.pending}>
                {t("save")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={edit.pending}
                onClick={() => save("draft")}
              >
                {t("unpublish")}
              </Button>
            </>
          )}
          {article && !confirmDelete && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="ms-auto text-danger"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden className="size-4" />
              {t("delete")}
            </Button>
          )}
        </div>
        {article && confirmDelete && (
          <div
            role="group"
            aria-label={t("delete")}
            className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface p-4"
          >
            <p className="flex-1 text-14 font-bold">{t("deleteConfirm")}</p>
            {deleteError && (
              <p role="alert" className="basis-full text-14 font-bold text-danger">
                {tErrors(deleteError)}
              </p>
            )}
            <Button
              type="button"
              size="sm"
              className="bg-danger"
              loading={deleting}
              onClick={() =>
                startDelete(async () => {
                  setDeleteError(null);
                  const result = await deleteArticle({ id: article.id });
                  if (result.status === "done") router.replace(routes.adminContent);
                  else setDeleteError(result.error);
                })
              }
            >
              {t("deleteYes")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={deleting}
              onClick={() => setConfirmDelete(false)}
            >
              {t("cancel")}
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}

/**
 * The cover: scaled to WebP (at most 1600 px on its longer edge) and
 * uploaded with the admin's session as soon as it is picked; the save
 * attaches it. A cover replaced before saving is deleted at once; one never
 * saved is deleted by the nightly cleanup after 72 h.
 */
function CoverPicker({ cover, onChange }: { cover: Cover; onChange: (cover: Cover) => void }) {
  const t = useTranslations("Admin.content.editor");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"failed" | "too_big" | null>(null);
  const hintId = useId();

  const replace = (next: Cover) => {
    if (cover?.uploaded) void discardCover({ path: cover.path });
    onChange(next);
  };

  const pick = async (file: File) => {
    setBusy(true);
    setProblem(null);
    try {
      const webp = await toWebp(file, COVER_MAX_EDGE);
      if (webp.size > PUBLIC_CONTENT_MAX_BYTES) {
        setProblem("too_big");
        return;
      }
      const path = `articles/${crypto.randomUUID()}.webp`;
      const bucket = createClient().storage.from("public-content");
      const { error } = await bucket.upload(path, webp, { contentType: "image/webp" });
      if (error) {
        setProblem("failed");
        return;
      }
      replace({ path, url: bucket.getPublicUrl(path).data.publicUrl, uploaded: true });
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-13 font-bold">{t("cover")}</span>
      {cover ? (
        // A public file; a plain <img> keeps it simple.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover.url}
          alt={t("coverPreview")}
          className="aspect-video w-full rounded-card border border-border bg-selected object-cover"
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-card border-2 border-dashed bg-surface text-teal">
          <ImagePlus aria-hidden className="size-8" />
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
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy}
          aria-describedby={hintId}
          onClick={() => input.current?.click()}
        >
          {cover ? t("coverReplace") : t("coverAdd")}
        </Button>
        {cover && (
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={busy}
            onClick={() => replace(null)}
          >
            <X aria-hidden className="size-4" />
            {t("coverRemove")}
          </Button>
        )}
      </div>
      <span
        id={hintId}
        aria-live="polite"
        className={cn("text-13", problem ? "font-bold text-danger" : "text-muted")}
      >
        {busy
          ? t("coverUploading")
          : problem === "too_big"
            ? t("coverTooBig")
            : problem === "failed"
              ? t("coverFailed")
              : t("coverHint")}
      </span>
    </div>
  );
}
