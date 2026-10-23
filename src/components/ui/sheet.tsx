"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { SheetHandle } from "./sheet-panel";

/**
 * Modal bottom sheet (address picker, cancel, reschedule). Radix Dialog
 * handles the focus trap, Esc, the overlay click and returning focus to
 * the trigger.
 *
 *   <Sheet>
 *     <SheetTrigger asChild><Button>…</Button></SheetTrigger>
 *     <SheetContent title="وين بيتك؟">…</SheetContent>
 *   </Sheet>
 *
 * Pass `open` and `onOpenChange` to Sheet to control it.
 */
export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

type SheetContentProps = {
  /** Required: it names the dialog for screen readers. */
  title: ReactNode;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function SheetContent({ title, description, className, children }: SheetContentProps) {
  const t = useTranslations("UI");

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-navy/40 data-[state=closed]:motion-safe:animate-fade-out data-[state=open]:motion-safe:animate-fade-in" />
      {/* The content box spans from 48px below the top to the bottom, so a
          tall sheet stops short of the top; its empty top part lets taps
          through to the overlay, which closes the sheet. */}
      <Dialog.Content
        // Without a description, Radix needs an explicit undefined here.
        {...(description ? {} : { "aria-describedby": undefined })}
        className="pointer-events-none fixed inset-x-0 top-12 bottom-0 z-50 flex flex-col justify-end data-[state=closed]:motion-safe:animate-sheet-out data-[state=open]:motion-safe:animate-sheet-in"
      >
        <div
          className={cn(
            "pointer-events-auto mx-auto flex max-h-full w-full max-w-phone flex-col gap-3 overflow-y-auto rounded-t-sheet bg-surface px-5 pt-3.5 pb-safe-6 text-navy shadow-sheet",
            className,
          )}
        >
          <SheetHandle />
          <div className="flex flex-col">
            <Dialog.Title className="text-20 font-black">{title}</Dialog.Title>
            {description && (
              <Dialog.Description className="text-14 text-muted">{description}</Dialog.Description>
            )}
          </div>
          {children}
          {/* The canvas has no close button: Esc, a tap on the overlay and
              the screen reader's dismiss gesture close the sheet. This
              button is for keyboard and screen reader users and shows only
              when focused. */}
          <Dialog.Close className="sr-only flex items-center justify-center gap-1 self-center text-14 font-bold text-teal focus:not-sr-only focus:min-h-11">
            <X aria-hidden className="size-4" />
            {t("close")}
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
