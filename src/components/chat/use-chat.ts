"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { contentTypeOf, type ContentType, mediaKindOf } from "@/lib/booking/media";
import type { ChatSendError, SendResult } from "@/lib/chat/errors";
import { fetchMessages } from "@/lib/chat/load";
import { CHAT_MEDIA_BUCKET, chatObjectPath } from "@/lib/chat/media";
import {
  type ChatMessage,
  type ChatRow,
  type ChatSide,
  type ChatTopic,
  fromRow,
  mergeMessages,
  unreadBy,
} from "@/lib/chat/messages";
import { checkVideo, type PrepareProblem, shrinkPhoto } from "@/lib/media/prepare";
import { createTusUpload } from "@/lib/media/tus";
import type { SendChatMessageInput } from "@/lib/schemas/chat";
import { createClient } from "@/lib/supabase/browser";
import { usePostgresChanges } from "@/lib/supabase/use-postgres-changes";

// One chat thread on screen (spec §5.16, A4): the messages, live through
// Realtime (inserts and read receipts; never DELETE, which skips RLS), the
// messages this device is sending, files uploading over TUS to chat-media,
// read marks while the screen is visible, and older pages.

/** Something the screen tells the sender: a refused file or a failed send. */
export type ChatNotice = ChatSendError | PrepareProblem | "unsupported";

export type Draft = {
  body?: string;
  orderId?: string;
  topic?: ChatTopic;
  file?: File;
};

type Outgoing = {
  input: Omit<SendChatMessageInput, "mediaPath" | "durationS">;
  file?: { blob: Blob; contentType: ContentType; path: string; durationS: number | null };
  /** The file is in Storage; a retry only sends. */
  uploaded: boolean;
};

export function useChat({
  threadId,
  side,
  uploaderId,
  initial,
  initialHasOlder,
  send,
  markRead,
  onMessage,
}: {
  threadId: string;
  side: ChatSide;
  /** The viewer's user id: their chat-media folder. */
  uploaderId: string;
  initial: ChatMessage[];
  initialHasOlder: boolean;
  send: (input: SendChatMessageInput) => Promise<SendResult>;
  markRead: (threadId: string) => Promise<unknown>;
  /** A message arrived through Realtime (for example, to refresh what it names). */
  onMessage?: (message: ChatMessage) => void;
}) {
  const [messages, setMessages] = useState(initial);
  const [hasOlder, setHasOlder] = useState(initialHasOlder);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [notice, setNotice] = useState<ChatNotice | null>(null);
  const outgoing = useRef(new Map<string, Outgoing>());

  // Fresh server data (a refresh) joins what is on screen. React's pattern
  // for state derived from props.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setMessages((current) => mergeMessages(current, initial));
  }

  const patch = useCallback((clientId: string, changes: Partial<ChatMessage>) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === null && message.clientId === clientId ? { ...message, ...changes } : message,
      ),
    );
  }, []);

  usePostgresChanges({
    table: "chat_messages",
    filter: `thread_id=eq.${threadId}`,
    events: ["INSERT", "UPDATE"],
    onChange: (row) => {
      const message = fromRow(row as ChatRow);
      setMessages((current) => mergeMessages(current, [message]));
      if (message.mediaPath) {
        void createClient()
          .storage.from(CHAT_MEDIA_BUCKET)
          .createSignedUrl(message.mediaPath, 60 * 60)
          .then(({ data }) => {
            if (data?.signedUrl) {
              setMessages((current) =>
                current.map((m) =>
                  m.id === message.id && !m.url ? { ...m, url: data.signedUrl } : m,
                ),
              );
            }
          });
      }
      onMessage?.(message);
    },
  });

  // Read marks: while the screen is visible and the other side's messages
  // wait. A hidden copy of the page (Next keeps visited pages) has no effects.
  const unread = messages.some((message) => unreadBy(message, side));
  const marking = useRef(false);
  useEffect(() => {
    if (!unread) return;
    const mark = () => {
      if (document.visibilityState !== "visible" || marking.current) return;
      marking.current = true;
      void markRead(threadId)
        .catch(() => undefined)
        .finally(() => {
          marking.current = false;
        });
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [unread, threadId, markRead]);

  const deliver = useCallback(
    async (clientId: string) => {
      const job = outgoing.current.get(clientId);
      if (!job) return;
      patch(clientId, { state: "sending" });
      let result: SendResult;
      try {
        result = await send({
          ...job.input,
          ...(job.file
            ? {
                mediaPath: job.file.path,
                ...(job.file.durationS !== null ? { durationS: job.file.durationS } : {}),
              }
            : {}),
        });
      } catch {
        result = { status: "error", error: "failed" };
      }
      if (result.status === "sent") {
        outgoing.current.delete(clientId);
        setMessages((current) => mergeMessages(current, [fromRow(result.message)]));
        return;
      }
      patch(clientId, { state: "failed" });
      setNotice(result.error);
      // A file the server can't find won't appear by sending again.
      if (result.error === "upload_missing") job.uploaded = false;
    },
    [patch, send],
  );

  const upload = useCallback(
    async (clientId: string) => {
      const job = outgoing.current.get(clientId);
      if (!job?.file) return;
      const { blob, path, contentType } = job.file;
      patch(clientId, { state: "uploading", progress: 0 });
      try {
        const tus = await createTusUpload(
          blob,
          { path, contentType, bucket: CHAT_MEDIA_BUCKET },
          {
            onProgress: (progress) => patch(clientId, { progress }),
            onSuccess: () => {
              job.uploaded = true;
              void deliver(clientId);
            },
            onError: () => {
              patch(clientId, { state: "failed" });
              setNotice("failed");
            },
          },
        );
        tus.start();
      } catch {
        patch(clientId, { state: "failed" });
        setNotice("failed");
      }
    },
    [deliver, patch],
  );

  /** Sends a message: text, a topic, an order tag and/or one file. */
  const post = useCallback(
    async (draft: Draft) => {
      setNotice(null);
      const clientId = crypto.randomUUID();
      const input = {
        clientId,
        ...(side === "admin" ? { threadId } : {}),
        ...(draft.body ? { body: draft.body } : {}),
        ...(draft.orderId ? { orderId: draft.orderId } : {}),
        ...(draft.topic ? { topic: draft.topic } : {}),
      };

      let file: Outgoing["file"];
      if (draft.file) {
        const contentType = contentTypeOf(draft.file);
        if (!contentType) {
          setNotice("unsupported");
          return false;
        }
        const kind = mediaKindOf(contentType);
        const prepared =
          kind === "video" ? await checkVideo(draft.file) : await shrinkPhoto(draft.file);
        if ("problem" in prepared) {
          setNotice(prepared.problem);
          return false;
        }
        file = {
          blob: prepared.file,
          contentType,
          path: chatObjectPath(uploaderId, crypto.randomUUID(), contentType),
          durationS: prepared.durationS,
        };
      }

      outgoing.current.set(clientId, { input, file, uploaded: false });
      const local: ChatMessage = {
        id: null,
        clientId,
        author: side,
        kind: "message",
        body: draft.body ?? null,
        mediaPath: file?.path ?? null,
        mediaType: file ? mediaKindOf(file.contentType) : null,
        durationS: file?.durationS ?? null,
        orderId: draft.orderId ?? null,
        topic: draft.topic ?? null,
        ticketId: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        at: Number.POSITIVE_INFINITY,
        state: file ? "uploading" : "sending",
        progress: 0,
        url: file ? URL.createObjectURL(file.blob) : null,
      };
      setMessages((current) => [...current, local]);
      if (file) void upload(clientId);
      else void deliver(clientId);
      return true;
    },
    [deliver, side, threadId, upload, uploaderId],
  );

  /** "أعد المحاولة" on a failed message: uploads again if needed, then sends. */
  const retry = useCallback(
    (clientId: string) => {
      const job = outgoing.current.get(clientId);
      if (!job) return;
      setNotice(null);
      if (job.file && !job.uploaded) void upload(clientId);
      else void deliver(clientId);
    },
    [deliver, upload],
  );

  const loadOlder = useCallback(async () => {
    const oldest = messages.find((message) => message.id !== null);
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await fetchMessages(createClient(), threadId, oldest.createdAt);
      setMessages((current) => mergeMessages(current, page.messages));
      setHasOlder(page.hasOlder);
    } catch {
      setNotice("failed");
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, messages, threadId]);

  return { messages, hasOlder, loadingOlder, loadOlder, post, retry, notice, setNotice };
}
