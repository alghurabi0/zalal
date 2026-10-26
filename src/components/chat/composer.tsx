"use client";

import { Navigation, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { CHAT_BODY_MAX } from "@/lib/schemas/chat";

/**
 * The bottom bar of Chat.dc.html: attach, the message box and send. A picked
 * file goes with whatever is typed as its caption. `above` holds the order
 * tag. Enter sends.
 */
export function Composer({
  onSend,
  onAttach,
  above,
}: {
  /** Returns false when nothing was sent, so the text stays. */
  onSend: (body: string) => Promise<boolean> | boolean;
  onAttach: (file: File, caption: string) => Promise<boolean> | boolean;
  above?: ReactNode;
}) {
  const t = useTranslations("Chat.composer");
  const [draft, setDraft] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    if (!(await onSend(body))) setDraft(body);
  };

  const attach = async (files: FileList | null) => {
    const file = files?.[0];
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    const caption = draft.trim();
    setDraft("");
    if (!(await onAttach(file, caption))) setDraft(caption);
  };

  return (
    <div className="sticky bottom-0 z-10 border-t border-border bg-surface">
      {above}
      <form onSubmit={submit} className="flex items-center gap-2 px-3 pt-2.5 pb-safe-5.5">
        <IconButton
          label={t("attach")}
          icon={Paperclip}
          variant="soft"
          onClick={() => fileInput.current?.click()}
          iconClassName="size-5.5"
        />
        <input
          ref={fileInput}
          type="file"
          accept="image/*,video/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => void attach(event.target.files)}
        />
        <label htmlFor={id} className="sr-only">
          {t("label")}
        </label>
        <input
          id={id}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("placeholder")}
          maxLength={CHAT_BODY_MAX}
          autoComplete="off"
          enterKeyHint="send"
          className="h-11 min-w-0 flex-1 rounded-full border border-border bg-bg px-3.5 text-15 text-navy placeholder:text-muted focus-visible:border-teal focus-visible:outline-none"
        />
        <IconButton
          type="submit"
          label={t("send")}
          icon={Navigation}
          variant="primary"
          iconClassName="rtl:-scale-x-100"
        />
      </form>
    </div>
  );
}
