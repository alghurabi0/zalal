"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

import { IconButton } from "@/components/ui/icon-button";

/**
 * A side panel over an admin list (the A2 order drawer), opened by the URL:
 * closing it goes to `closeHref`, the same list without the drawer. Radix
 * Dialog traps focus, closes on Esc and the overlay, and names the panel.
 */
export function Drawer({
  title,
  closeHref,
  children,
}: {
  title: ReactNode;
  closeHref: string;
  children: ReactNode;
}) {
  const t = useTranslations("UI");
  const router = useRouter();

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) router.push(closeHref, { scroll: false });
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-navy/40 motion-safe:animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 end-0 z-50 flex w-full max-w-xl flex-col bg-bg text-navy shadow-sheet motion-safe:animate-fade-in"
        >
          <div className="flex items-center gap-3 border-b border-border bg-surface px-5 py-3">
            <Dialog.Title className="flex flex-1 flex-wrap items-center gap-2 text-20 font-black">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <IconButton icon={X} label={t("close")} variant="soft" />
            </Dialog.Close>
          </div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 pt-4 pb-safe-6">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
