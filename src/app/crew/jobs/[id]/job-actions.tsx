"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { type CrewJobError, FINISH_FIELD_ERRORS } from "@/lib/crew/errors";
import { isPending } from "@/lib/crew/media-queue";
import { canMarkNoShow, nextStep } from "@/lib/crew/status";
import type { OrderStatus } from "@/lib/orders/status";
import { STAFF_NOTE_MAX } from "@/lib/schemas/admin-order";
import {
  finishErrorOf,
  finishJobSchema,
  parseChlorine,
  STERILANT_MAX,
} from "@/lib/schemas/crew-job";

import { advanceJob, type CrewJobResult, finishJob, markNoShow } from "../../actions";
import { useCrewMedia } from "../../use-crew-media";

/**
 * C3a: one big button that moves the job on (طلعنا → وصلنا → بدينا الشغل →
 * خلصنا), and "الزبون مو موجود" until work starts. خلصنا opens the finish
 * form (C4). The database checks every move again.
 */
export function JobActions({
  userId,
  orderId,
  status,
  amount,
  covered,
  sterilantText,
}: {
  userId: string;
  orderId: string;
  status: OrderStatus;
  /** The order total, formatted ("35,000 د.ع"). */
  amount: string;
  /** A subscription order: nothing to collect, so C4 has no cash tick. */
  covered: boolean;
  /** settings.sterilant_text, which C4 starts from. */
  sterilantText: string;
}) {
  const t = useTranslations("Crew");
  const { error, pending, submit } = useJobAction();
  const step = nextStep(status);
  if (!step) return null;

  return (
    <footer className="sticky bottom-0 z-10 flex flex-col gap-2.5 border-t border-border bg-surface px-5 pt-3 pb-safe-5.5">
      {error && <ErrorText error={error} />}
      {step.to === "completed" ? (
        <FinishSheet
          userId={userId}
          orderId={orderId}
          amount={amount}
          covered={covered}
          sterilantText={sterilantText}
        >
          <Button size="footer" className="w-full">
            {t(`steps.${step.label}`)}
          </Button>
        </FinishSheet>
      ) : (
        <Button
          size="footer"
          className="w-full"
          loading={pending}
          onClick={() => submit(() => advanceJob({ orderId, toStatus: step.to }))}
        >
          {t(`steps.${step.label}`)}
        </Button>
      )}
      {canMarkNoShow(status) && (
        <NoShowSheet orderId={orderId}>
          <Button
            variant="secondary"
            size="footer"
            className="w-full text-danger"
            disabled={pending}
          >
            {t("noShow.open")}
          </Button>
        </NoShowSheet>
      )}
    </footer>
  );
}

function ErrorText({ error }: { error: CrewJobError }) {
  const t = useTranslations("Crew.errors");
  return (
    <p role="alert" className="rounded-chip bg-warn-bg px-3 py-2 text-14 font-bold text-warn-fg">
      {t(error)}
    </p>
  );
}

/**
 * Runs a status change. On success (then `onDone`) or a stale page, the page
 * reloads its data. A request that never gets an answer (no signal in the
 * field) shows "ما انحفظ" instead of the error screen.
 */
function useJobAction(onDone?: () => void) {
  const router = useRouter();
  const [error, setError] = useState<CrewJobError | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (action: () => Promise<CrewJobResult>) =>
    startTransition(async () => {
      let result: CrewJobResult;
      try {
        result = await action();
      } catch {
        setError("failed");
        return;
      }
      if (result.status === "done") {
        setError(null);
        onDone?.();
        router.refresh();
        return;
      }
      setError(result.error);
      if (result.error === "invalid_transition" || result.error === "not_found") router.refresh();
    });

  return { error, setError, pending, submit };
}

/** A sheet's open state plus its action. */
function useSheetAction() {
  const [open, setOpen] = useState(false);
  return { open, setOpen, ...useJobAction(() => setOpen(false)) };
}

type FinishFieldError = (typeof FINISH_FIELD_ERRORS)[number];

const isFieldError = (error: CrewJobError | null): error is FinishFieldError =>
  FINISH_FIELD_ERRORS.some((key) => key === error);

/**
 * C4: the sterilant (from the company's text), the residual chlorine reading
 * (optional), the cash tick (not for a subscription order) and an
 * internal note. Files still in the queue keep uploading afterwards.
 */
function FinishSheet({
  userId,
  orderId,
  amount,
  covered,
  sterilantText,
  children,
}: {
  userId: string;
  orderId: string;
  amount: string;
  covered: boolean;
  sterilantText: string;
  children: ReactNode;
}) {
  const t = useTranslations("Crew.finish");
  const tUI = useTranslations("UI");
  const tErrors = useTranslations("Crew.errors");
  const { open, setOpen, error, setError, pending, submit } = useSheetAction();
  const [cash, setCash] = useState(false);
  const [sterilant, setSterilant] = useState(sterilantText);
  const [chlorine, setChlorine] = useState("");
  const [note, setNote] = useState("");
  const uploading = useCrewMedia(userId).filter(
    (item) => item.orderId === orderId && isPending(item),
  ).length;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setCash(false);
      setSterilant(sterilantText);
      setChlorine("");
      setNote("");
      setError(null);
    }
  };

  const confirm = () => {
    const input = {
      orderId,
      covered,
      cashCollected: !covered && cash,
      sterilant,
      residualChlorine: parseChlorine(chlorine),
      note,
    };
    const parsed = finishJobSchema.safeParse(input);
    if (!parsed.success) {
      setError(finishErrorOf(parsed.error));
      return;
    }
    submit(() => finishJob(parsed.data));
  };

  const fieldError = (...keys: FinishFieldError[]) =>
    error && keys.some((key) => key === error) ? tErrors(error) : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent title={t("title")} description={t("description")}>
        <Field
          variant="compact"
          label={t("sterilant")}
          hint={t("sterilantHint")}
          error={fieldError("sterilant_required", "invalid_sterilant")}
        >
          {(control) => (
            <Input
              {...control}
              variant="compact"
              maxLength={STERILANT_MAX}
              value={sterilant}
              onChange={(event) => {
                setSterilant(event.target.value);
                setError(null);
              }}
            />
          )}
        </Field>
        <Field
          variant="compact"
          label={t("chlorine")}
          hint={t("chlorineHint")}
          error={fieldError("invalid_chlorine")}
        >
          {(control) => (
            <Input
              {...control}
              variant="compact"
              inputMode="decimal"
              dir="ltr"
              autoComplete="off"
              maxLength={5}
              value={chlorine}
              onChange={(event) => {
                setChlorine(event.target.value);
                setError(null);
              }}
            />
          )}
        </Field>
        <Field
          variant="compact"
          label={t("note")}
          hint={t("noteHint")}
          error={fieldError("note_too_long")}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={STAFF_NOTE_MAX}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setError(null);
              }}
            />
          )}
        </Field>
        {covered ? (
          <p className="flex min-h-13 items-center rounded-input bg-ok-bg px-4 text-15 font-bold text-ok-fg">
            {tUI("covered")}
          </p>
        ) : (
          <label className="flex min-h-13 items-center gap-3 rounded-input border border-border px-4 text-15 font-bold">
            <input
              type="checkbox"
              className="size-5.5 accent-navy"
              checked={cash}
              aria-invalid={error === "cash_not_collected" ? true : undefined}
              onChange={(event) => {
                setCash(event.target.checked);
                setError(null);
              }}
            />
            <span>{t("cash", { amount })}</span>
          </label>
        )}
        {uploading > 0 && (
          <p role="status" className="text-14 text-body-2">
            {t("pending", { count: uploading })}
          </p>
        )}
        {error && (error === "cash_not_collected" || !isFieldError(error)) && (
          <ErrorText error={error} />
        )}
        <Button size="footer" className="w-full" loading={pending} onClick={confirm}>
          {t("confirm")}
        </Button>
        <SheetClose asChild>
          <Button variant="link" size="sm" className="w-full" disabled={pending}>
            {t("keep")}
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}

function NoShowSheet({ orderId, children }: { orderId: string; children: ReactNode }) {
  const t = useTranslations("Crew.noShow");
  const tErrors = useTranslations("Crew.errors");
  const { open, setOpen, error, setError, pending, submit } = useSheetAction();
  const [note, setNote] = useState("");
  const empty = note.trim() === "";

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setNote("");
      setError(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent title={t("title")} description={t("description")}>
        <Field
          label={t("label")}
          error={error === "reason_required" ? tErrors("reason_required") : undefined}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={4}
              maxLength={STAFF_NOTE_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
        {error && error !== "reason_required" && <ErrorText error={error} />}
        <Button
          size="footer"
          className="w-full"
          loading={pending}
          onClick={() => {
            if (empty) {
              setError("reason_required");
              return;
            }
            submit(() => markNoShow({ orderId, note: note.trim() }));
          }}
        >
          {t("confirm")}
        </Button>
        <SheetClose asChild>
          <Button variant="link" size="sm" className="w-full" disabled={pending}>
            {t("keep")}
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
