import { contentTypeOf, mediaKindOf } from "@/lib/booking/media";
import type { Prepared, PrepareProblem } from "@/lib/media/prepare";
import type { TusCallbacks } from "@/lib/media/tus";

import type { JobMediaError } from "./errors";
import { type JobMediaKind, jobObjectPath } from "./media";
import type { MediaStore, StoredFile } from "./media-store";

// The crew's media queue (spec §8.1 C3b). A photo or clip goes through:
// preparing (shrunk or checked on the phone) → waiting → uploading (TUS
// straight to Storage) → attaching (attach_job_media) → attached. Files wait
// in IndexedDB (media-store.ts) until they are attached, so:
// - Offline: items wait and start again when the browser is back online,
//   or on the next try (5 s, 15 s, 30 s, then every minute).
// - Reload: the queue reloads the account's files and resumes each upload
//   from its saved TUS URL; attaching again is safe (same row).
// - Shared phone: the queue only ever loads the logged-in account's files
//   and deletes any other account's when it starts; logout deletes them all
//   (clearMediaQueue).
// One file uploads at a time, so a weak signal isn't split between files.
// Kept outside React, like Booking's uploads, and read with
// useSyncExternalStore.

export type QueueStatus =
  "preparing" | "waiting" | "uploading" | "attaching" | "attached" | "failed";

/** Why a file stopped for good: the database's answer, or Storage refused it. */
export type QueueError = Exclude<JobMediaError, "failed"> | "upload_refused";

export type QueueItem = {
  id: string;
  orderId: string;
  kind: JobMediaKind;
  path: string;
  bytes: number;
  durationS: number | null;
  status: QueueStatus;
  /** 0–100. */
  progress: number;
  error: QueueError | null;
  /** The file itself, for the preview. */
  file: Blob | null;
};

export type AddProblem = "too_many" | "unsupported" | PrepareProblem;

export type AttachResult =
  { status: "done"; id: string } | { status: "error"; error: JobMediaError };

type Uploader = {
  start(): void;
  abort(terminate?: boolean): Promise<void>;
};

export type QueueDeps = {
  openStore: () => Promise<MediaStore>;
  deleteStore: () => Promise<void>;
  upload: (
    file: Blob,
    target: { path: string; contentType: string; uploadUrl: string | null },
    callbacks: TusCallbacks,
  ) => Promise<Uploader>;
  prepare: (file: File, kind: "photo" | "video") => Promise<Prepared>;
  /** Deletes an uploaded file that will never be attached (best effort). */
  removeObject: (path: string) => Promise<void>;
  online: () => boolean;
  now: () => number;
  setTimer: (run: () => void, ms: number) => () => void;
};

const RETRY_MS = [5_000, 15_000, 30_000, 60_000];
const EMPTY: QueueItem[] = [];

/** Statuses that still need the network. */
export const isPending = (item: QueueItem) =>
  item.status !== "attached" && item.status !== "failed";

export class MediaQueue {
  private userId: string | null = null;
  private items: QueueItem[] = EMPTY;
  private records = new Map<string, StoredFile>();
  private retries = new Map<string, { attempts: number; at: number }>();
  /** Uploads under way; `settle` ends the wait when one is aborted. */
  private running = new Map<string, { upload: Uploader | null; settle: () => void }>();
  private store: Promise<MediaStore> | null = null;
  private attach: ((input: AttachInput) => Promise<AttachResult>) | null = null;
  private listeners = new Set<() => void>();
  private attachedListeners = new Set<(item: QueueItem) => void>();
  private pumping = false;
  private cancelTimer: (() => void) | null = null;
  /** Bumped on every reset, so work started for an old account stops. */
  private generation = 0;

  constructor(private readonly deps: QueueDeps) {}

  // Reading --------------------------------------------------------------------

  /** The account's items, or none while another account's queue is loaded. */
  getItems(userId: string): QueueItem[] {
    return this.userId === userId ? this.items : EMPTY;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Called once per file attached, so the page can show it from the server. */
  onAttached(listener: (item: QueueItem) => void) {
    this.attachedListeners.add(listener);
    return () => {
      this.attachedListeners.delete(listener);
    };
  }

  // Lifecycle ------------------------------------------------------------------

  /**
   * Loads the account's queue and starts sending it. Another account's queue
   * is dropped first, from memory and from the store.
   */
  async start(userId: string, attach: (input: AttachInput) => Promise<AttachResult>) {
    this.attach = attach;
    if (this.userId === userId) {
      void this.pump();
      return;
    }
    this.reset();
    this.userId = userId;
    const generation = this.generation;
    const store = this.openStore();
    let saved: StoredFile[] = [];
    try {
      const all = await (await store).all();
      const others = all.filter((file) => file.userId !== userId);
      await Promise.all(others.map(async (file) => (await store).delete(file.id)));
      saved = all.filter((file) => file.userId === userId);
    } catch {
      saved = [];
    }
    if (generation !== this.generation) return;
    saved.sort((a, b) => a.createdAt - b.createdAt);
    for (const file of saved) this.records.set(file.id, file);
    this.set([...this.items, ...saved.map(toItem)]);
    void this.pump();
    // Files the page closed on while they were being prepared.
    void (async () => {
      for (const file of saved.filter((f) => !f.prepared)) await this.prepare(file, generation);
    })();
  }

  /** Logout: stops everything and deletes every queued file on this phone. */
  async clear() {
    this.reset();
    const store = this.store;
    this.store = null;
    if (store) (await store.catch(() => null))?.close();
    await this.deps.deleteStore();
  }

  /** The browser is back online, or the page is shown again. */
  wake() {
    for (const [id, retry] of this.retries) this.retries.set(id, { ...retry, at: 0 });
    void this.pump();
  }

  private reset() {
    this.generation += 1;
    for (const job of this.running.values()) {
      void job.upload?.abort().catch(() => undefined);
      job.settle();
    }
    this.running.clear();
    this.records.clear();
    this.retries.clear();
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.userId = null;
    this.set(EMPTY);
  }

  private openStore() {
    this.store ??= this.deps.openStore();
    return this.store;
  }

  // Changes --------------------------------------------------------------------

  /**
   * Checks the picked files, prepares the ones that fit (`room` is how many
   * more of this kind the job takes) and queues them. Resolves with what was
   * refused.
   */
  async add(
    userId: string,
    target: { crewId: string; orderId: string; kind: JobMediaKind; room: number },
    files: File[],
  ): Promise<AddProblem[]> {
    if (this.userId !== userId) return [];
    const generation = this.generation;
    const problems: AddProblem[] = [];
    const wanted = target.kind === "clip" ? "video" : "photo";
    const fitting = files.flatMap((file) => {
      const contentType = contentTypeOf(file);
      if (contentType && mediaKindOf(contentType) === wanted) return [{ file, contentType }];
      problems.push("unsupported");
      return [];
    });
    const room = Math.max(target.room, 0);
    if (fitting.length > room) problems.push("too_many");

    for (const { file, contentType } of fitting.slice(0, room)) {
      const id = crypto.randomUUID();
      const record: StoredFile = {
        id,
        userId,
        orderId: target.orderId,
        kind: target.kind,
        path: jobObjectPath(target.crewId, target.orderId, id, contentType),
        contentType,
        bytes: file.size,
        durationS: null,
        uploadUrl: null,
        prepared: false,
        uploaded: false,
        createdAt: this.deps.now(),
        file,
      };
      this.records.set(id, record);
      this.set([...this.items, toItem(record)]);
      await this.save(record);
      const problem = await this.prepare(record, generation);
      if (generation !== this.generation) return problems;
      if (problem) problems.push(problem);
    }
    return problems;
  }

  /** Shrinks or checks a saved file, then queues it. Resolves with why it was refused. */
  private async prepare(record: StoredFile, generation: number): Promise<PrepareProblem | null> {
    const source =
      record.file instanceof File
        ? record.file
        : new File([record.file], record.id, { type: record.contentType });
    const prepared = await this.deps.prepare(source, record.kind === "clip" ? "video" : "photo");
    // Removed, or another account, while it was being prepared.
    if (generation !== this.generation || !this.records.has(record.id)) return null;
    if ("problem" in prepared) {
      this.records.delete(record.id);
      this.set(this.items.filter((item) => item.id !== record.id));
      await this.forget(record.id);
      return prepared.problem;
    }
    record.file = prepared.file;
    record.bytes = prepared.file.size;
    record.durationS = prepared.durationS;
    record.prepared = true;
    await this.save(record);
    this.patch(record.id, {
      bytes: record.bytes,
      durationS: record.durationS,
      file: record.file,
      status: "waiting",
    });
    void this.pump();
    return null;
  }

  retry(userId: string, id: string) {
    if (this.userId !== userId || !this.records.has(id)) return;
    this.retries.delete(id);
    this.patch(id, { status: "waiting", error: null });
    void this.pump();
  }

  /** The × on a queued file: stops it, forgets it, and deletes an uploaded copy. */
  async remove(userId: string, id: string) {
    if (this.userId !== userId) return;
    const record = this.records.get(id);
    const job = this.running.get(id);
    this.running.delete(id);
    this.records.delete(id);
    this.retries.delete(id);
    this.set(this.items.filter((item) => item.id !== id));
    // true: also ends the upload on the server.
    void job?.upload?.abort(true).catch(() => undefined);
    job?.settle();
    if (record?.uploaded) void this.deps.removeObject(record.path).catch(() => undefined);
    await this.forget(id);
  }

  /** Attached files the page now shows from the server. */
  dropAttached(paths: ReadonlySet<string>) {
    const left = this.items.filter((item) => !(item.status === "attached" && paths.has(item.path)));
    if (left.length !== this.items.length) this.set(left);
  }

  // Sending ------------------------------------------------------------------------

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    const generation = this.generation;
    try {
      while (generation === this.generation && this.deps.online()) {
        const now = this.deps.now();
        const next = this.items.find(
          (item) => item.status === "waiting" && (this.retries.get(item.id)?.at ?? 0) <= now,
        );
        if (!next) break;
        await this.send(next.id, generation);
      }
    } finally {
      this.pumping = false;
    }
    if (generation === this.generation) this.scheduleRetry();
  }

  private scheduleRetry() {
    this.cancelTimer?.();
    this.cancelTimer = null;
    const waiting = this.items.filter((item) => item.status === "waiting");
    if (waiting.length === 0) return;
    const at = Math.min(...waiting.map((item) => this.retries.get(item.id)?.at ?? 0));
    this.cancelTimer = this.deps.setTimer(
      () => void this.pump(),
      Math.max(at - this.deps.now(), 1000),
    );
  }

  private async send(id: string, generation: number) {
    const record = this.records.get(id);
    if (!record) return;
    const stale = () => generation !== this.generation || !this.records.has(id);

    if (!record.uploaded) {
      this.patch(id, { status: "uploading", progress: 0, error: null });
      const outcome = await this.uploadOnce(record);
      if (stale()) return;
      // 409: Storage already has the file (the answer to an earlier try was lost).
      if (outcome === "done" || outcome === 409) {
        record.uploaded = true;
        await this.save(record);
      } else if (outcome === null || outcome >= 500 || [408, 423, 429].includes(outcome)) {
        this.later(id);
        return;
      } else {
        this.fail(id, "upload_refused");
        return;
      }
    }

    this.patch(id, { status: "attaching", progress: 100 });
    let result: AttachResult;
    try {
      if (!this.attach) throw new Error("Queue not started");
      result = await this.attach({
        orderId: record.orderId,
        kind: record.kind,
        path: record.path,
        durationS: record.durationS,
      });
    } catch {
      // No answer (no signal): try again later.
      if (!stale()) this.later(id);
      return;
    }
    if (stale()) return;
    if (result.status === "done") {
      this.records.delete(id);
      this.retries.delete(id);
      await this.forget(id);
      this.patch(id, { status: "attached", error: null });
      const item = this.items.find((i) => i.id === id);
      if (item) for (const listener of this.attachedListeners) listener(item);
    } else if (result.error === "failed") {
      this.later(id);
    } else {
      this.fail(id, result.error);
    }
  }

  /** Resolves with "done", or the HTTP status of the failure (null: no answer). */
  private uploadOnce(record: StoredFile): Promise<"done" | number | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome: "done" | number | null) => {
        if (settled) return;
        settled = true;
        this.running.delete(record.id);
        resolve(outcome);
      };
      const job: { upload: Uploader | null; settle: () => void } = {
        upload: null,
        settle: () => finish(null),
      };
      this.running.set(record.id, job);
      void (async () => {
        try {
          job.upload = await this.deps.upload(
            record.file,
            { path: record.path, contentType: record.contentType, uploadUrl: record.uploadUrl },
            {
              onProgress: (percent) => this.patch(record.id, { progress: percent }),
              onUrl: (url) => {
                if (record.uploadUrl === url) return;
                record.uploadUrl = url;
                void this.save(record);
              },
              onSuccess: () => finish("done"),
              onError: (status) => finish(status),
            },
          );
          if (!settled) job.upload.start();
        } catch {
          // The upload library didn't load (offline).
          finish(null);
        }
      })();
    });
  }

  private later(id: string) {
    const attempts = (this.retries.get(id)?.attempts ?? 0) + 1;
    const delay = RETRY_MS[Math.min(attempts, RETRY_MS.length) - 1] ?? 60_000;
    this.retries.set(id, { attempts, at: this.deps.now() + delay });
    this.patch(id, { status: "waiting" });
  }

  private fail(id: string, error: QueueError) {
    this.retries.delete(id);
    this.patch(id, { status: "failed", error });
  }

  private async save(record: StoredFile) {
    try {
      await (await this.openStore()).put(record);
    } catch {
      // Storage full or blocked: the file still uploads while the page is open.
    }
  }

  private async forget(id: string) {
    try {
      await (await this.openStore()).delete(id);
    } catch {
      // Nothing to do: the record is gone from memory.
    }
  }

  private set(items: QueueItem[]) {
    this.items = items;
    for (const listener of this.listeners) listener();
  }

  private patch(id: string, changes: Partial<QueueItem>) {
    this.set(this.items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }
}

type AttachInput = {
  orderId: string;
  kind: JobMediaKind;
  path: string;
  durationS: number | null;
};

function toItem(file: StoredFile): QueueItem {
  return {
    id: file.id,
    orderId: file.orderId,
    kind: file.kind,
    path: file.path,
    bytes: file.bytes,
    durationS: file.durationS,
    status: file.prepared ? "waiting" : "preparing",
    progress: file.uploaded ? 100 : 0,
    error: null,
    file: file.file,
  };
}
