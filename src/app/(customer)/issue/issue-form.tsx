"use client";

import { Check, Play, Plus, RotateCw, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ChangeEvent, useEffect, useRef, useState, useTransition } from "react";

import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Chip, ChipGroup } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
import type { AddProblem } from "@/lib/booking/uploads";
import { ticketNumber } from "@/lib/certificates/format";
import { cn } from "@/lib/cn";
import { routes } from "@/lib/routes";
import type { IssueError } from "@/lib/tickets/errors";
import {
  TICKET_CATEGORIES,
  TICKET_DESCRIPTION_MAX,
  TICKET_DESCRIPTION_MIN,
  type TicketCategory,
} from "@/lib/tickets/format";
import { MAX_TICKET_FILES } from "@/lib/tickets/media";

import { createTicket } from "./actions";
import { type IssueFile, useIssueFiles } from "./use-issue-files";

type FormError = "category" | "tooShort" | "tooLong" | "filesFailed" | IssueError;

const busy = (file: IssueFile) => file.status === "preparing" || file.status === "uploading";

/**
 * The Issue report's form and its success state (Issue.dc.html). Sending
 * waits for the files to finish uploading; a failed file must be retried or
 * removed first.
 */
export function IssueForm({
  userId,
  orders,
  initialOrderId,
  responseHours,
  back,
}: {
  userId: string;
  /** The orders it can name, newest first, with their labels. */
  orders: { id: string; label: string }[];
  /** "" for بدون طلب. */
  initialOrderId: string;
  responseHours: number;
  back: string;
}) {
  const t = useTranslations("Issue");
  const [category, setCategory] = useState<TicketCategory | null>(null);
  const [orderId, setOrderId] = useState(initialOrderId);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [problems, setProblems] = useState<AddProblem[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  // One id per report, so a retry after a lost answer returns the same ticket.
  const [clientId] = useState(() => crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);
  const { files, add, retry, remove, forget } = useIssueFiles(userId);

  const uploading = files.some(busy);
  const full = files.length >= MAX_TICKET_FILES;

  const send = () => {
    const trimmed = description.trim();
    if (!category) return setError("category");
    if (trimmed.length < TICKET_DESCRIPTION_MIN) return setError("tooShort");
    if (trimmed.length > TICKET_DESCRIPTION_MAX) return setError("tooLong");
    if (files.some((file) => file.status === "failed")) return setError("filesFailed");
    if (files.some(busy)) {
      setError(null);
      setWaiting(true);
      return;
    }
    setWaiting(false);
    setError(null);
    startTransition(async () => {
      const result = await createTicket({
        clientId,
        category,
        description: trimmed,
        orderId: orderId || undefined,
        media: files.map((file) => ({
          path: file.path,
          durationS: file.durationS ?? undefined,
        })),
      });
      if (result.status === "error") {
        setError(result.error);
        return;
      }
      forget();
      setSent(result.number);
    });
  };

  // Sending waits for the uploads (spec §5.17, as Upload's confirm).
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    if (waiting && !uploading) sendRef.current();
  }, [waiting, uploading]);

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    // Lets the same file be picked again after it's removed.
    event.target.value = "";
    if (picked.length === 0) return;
    setProblems([]);
    setProblems(await add(picked));
  };

  if (sent !== null) return <IssueSent number={sent} />;

  const problemText: Record<AddProblem, string> = {
    too_many: t("errors.tooManyFiles", { max: MAX_TICKET_FILES }),
    unsupported: t("errors.unsupported"),
    too_long: t("errors.tooLongVideo"),
    too_big: t("errors.tooBig"),
    unreadable: t("errors.unreadable"),
  };
  const descriptionError =
    error === "tooShort"
      ? t("errors.tooShort", { min: TICKET_DESCRIPTION_MIN })
      : error === "tooLong"
        ? t("errors.tooLong", { max: TICKET_DESCRIPTION_MAX })
        : undefined;
  const formError =
    error && error !== "tooShort" && error !== "tooLong" ? t(`errors.${error}`) : null;

  return (
    <>
      <header className="flex items-center gap-3 px-5 pt-4.5 pb-2.5">
        <BackButton href={back} />
        <div className="flex flex-1 flex-col">
          <h1 className="text-20 font-black">{t("title")}</h1>
          <span className="text-13 text-muted">{t("response", { hours: responseHours })}</span>
        </div>
      </header>

      <form
        id="issue"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="flex flex-1 flex-col gap-3.5 px-5 pt-1 pb-6"
      >
        <ChipGroup
          legend={t("categoryLegend")}
          bodyClassName="grid grid-cols-2 gap-2"
          legendClassName="mb-2"
        >
          {TICKET_CATEGORIES.map((item) => (
            <Chip
              key={item}
              type="radio"
              name="category"
              value={item}
              checked={category === item}
              onChange={() => {
                setCategory(item);
                if (error === "category") setError(null);
              }}
              className="min-h-12.5 px-2.5 py-1.5 text-body-2"
            >
              {t(`categories.${item}`)}
            </Chip>
          ))}
        </ChipGroup>

        <Field label={<span className="font-extrabold">{t("order")}</span>} className="gap-1.5">
          {(control) => (
            <Select
              {...control}
              name="order"
              value={orderId}
              onChange={(event) => {
                setOrderId(event.target.value);
                if (error === "order_unavailable") setError(null);
              }}
              className="h-12 rounded-chip px-3 text-15"
            >
              {orders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
              <option value="">{t("noOrder")}</option>
            </Select>
          )}
        </Field>

        <Field
          label={<span className="font-extrabold">{t("description")}</span>}
          error={descriptionError}
          className="gap-1.5"
        >
          {(control) => (
            <Textarea
              {...control}
              name="description"
              rows={3}
              maxLength={TICKET_DESCRIPTION_MAX}
              value={description}
              placeholder={t("descriptionPlaceholder")}
              onChange={(event) => {
                setDescription(event.target.value);
                if (error === "tooShort" || error === "tooLong") setError(null);
              }}
              className="rounded-chip"
            />
          )}
        </Field>

        <div className="flex flex-col gap-2">
          <ul aria-label={t("filesLabel")} className="flex flex-wrap items-center gap-2">
            <li>
              <button
                type="button"
                disabled={full}
                aria-label={t("addFileLabel")}
                onClick={() => fileInput.current?.click()}
                className="flex size-16 flex-col items-center justify-center gap-0.5 rounded-input border-2 border-dashed bg-surface text-11 font-bold text-teal disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus aria-hidden className="size-5" strokeWidth={2} />
                <span aria-hidden>{t("addFile")}</span>
              </button>
            </li>
            {files.map((file, index) => (
              <FileTile
                key={file.id}
                file={file}
                n={index + 1}
                onRetry={() => retry(file)}
                onRemove={() => {
                  remove(file);
                  if (error === "filesFailed") setError(null);
                }}
              />
            ))}
          </ul>
          {/* The tile above is the control; this only opens the picker. */}
          <input
            ref={fileInput}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={pick}
          />
          <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
            {full && <p className="text-13 text-muted">{t("limit", { max: MAX_TICKET_FILES })}</p>}
            {[...new Set(problems)].map((problem) => (
              <p key={problem} className="text-14 font-bold text-danger">
                {problemText[problem]}
              </p>
            ))}
          </div>
        </div>

        <div aria-live="polite" className="empty:hidden">
          {waiting && uploading && (
            <p className="text-14 font-bold text-teal">{t("waitingFiles")}</p>
          )}
          {formError && (
            <p role="alert" className="text-14 font-bold text-danger">
              {formError}
            </p>
          )}
        </div>
      </form>

      <footer className="sticky bottom-0 z-10 border-t border-border bg-surface px-5 pt-3 pb-safe-5.5">
        <Button type="submit" form="issue" className="w-full" loading={pending || waiting}>
          {t("submit")}
        </Button>
      </footer>
    </>
  );
}

function FileTile({
  file,
  n,
  onRetry,
  onRemove,
}: {
  file: IssueFile;
  n: number;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("Issue");
  const name = t("fileName", { kind: file.kind, n });
  const status =
    file.status === "failed"
      ? t("fileFailed")
      : file.status === "done"
        ? null
        : t("fileUploading", { percent: file.progress });

  return (
    <li className="relative">
      <span
        className={cn(
          "relative flex size-16 items-center justify-center overflow-hidden rounded-input bg-navy-2",
          file.status === "failed" && "ring-2 ring-danger",
        )}
      >
        {file.previewUrl ? (
          // A local object URL: next/image can't load it.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.previewUrl} alt={name} className="size-full object-cover" />
        ) : (
          <>
            <Play aria-hidden className="size-4.5 text-aqua" fill="currentColor" strokeWidth={0} />
            <span className="sr-only">{name}</span>
          </>
        )}
        {busy(file) && (
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-11 font-bold text-white"
          >
            <span dir="ltr">{file.progress}%</span>
          </span>
        )}
      </span>
      {file.status === "failed" && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={t("retryFile", { name })}
          className="absolute inset-0 flex items-center justify-center rounded-input bg-black/55 text-white"
        >
          <RotateCw aria-hidden className="size-5" strokeWidth={2.4} />
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("removeFile", { name })}
        className="absolute -end-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border-2 border-bg bg-navy text-white after:absolute after:-inset-2.5"
      >
        <X aria-hidden className="size-3.5" strokeWidth={2.6} />
      </button>
      {status && <span className="sr-only">{status}</span>}
    </li>
  );
}

function IssueSent({ number }: { number: number }) {
  const t = useTranslations("Issue");
  return (
    <EmptyState
      icon={Check}
      tone="success"
      titleAs="h1"
      title={t("sent")}
      description={
        <span role="status">
          {t.rich("sentBody", {
            ticket: ticketNumber(number),
            num: (chunks) => (
              <span dir="ltr" className="font-black text-navy">
                {chunks}
              </span>
            ),
          })}
        </span>
      }
      action={
        <>
          <Button href={routes.chat} size="footer" className="w-full">
            {t("openChat")}
          </Button>
          <Link
            href={routes.home}
            className="flex min-h-11 items-center text-15 font-bold text-teal hover:text-navy"
          >
            {t("home")}
          </Link>
        </>
      }
      className="flex-1 justify-center"
    />
  );
}
