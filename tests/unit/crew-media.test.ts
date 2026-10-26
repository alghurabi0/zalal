import { describe, expect, it, vi } from "vitest";

import { crewJobErrorFor, jobMediaErrorFor } from "@/lib/crew/errors";
import { captureKinds, canRemoveJobMedia, jobObjectPath, orderIdOfPath } from "@/lib/crew/media";
import { type AttachResult, MediaQueue, type QueueDeps } from "@/lib/crew/media-queue";
import { memoryStore, type MediaStore, type StoredFile } from "@/lib/crew/media-store";
import type { TusCallbacks } from "@/lib/media/tus";
import { attachJobMediaSchema, finishJobSchema, parseChlorine } from "@/lib/schemas/crew-job";

const CREW = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("job media rules", () => {
  it("offers before photos from arrival, after photos and clips while working", () => {
    expect(captureKinds("on_the_way")).toEqual([]);
    expect(captureKinds("arrived")).toEqual(["before"]);
    expect(captureKinds("in_progress")).toEqual(["before", "after", "clip"]);
    expect(captureKinds("completed")).toEqual([]);
    expect(canRemoveJobMedia("in_progress")).toBe(true);
    expect(canRemoveJobMedia("completed")).toBe(false);
  });

  it("puts files in the crew's folder for the order", () => {
    const path = jobObjectPath(CREW, ORDER, FILE, "image/jpeg");
    expect(path).toBe(`crew/${CREW}/${ORDER}/${FILE}.jpg`);
    expect(orderIdOfPath(path)).toBe(ORDER);
    expect(orderIdOfPath(`crew/${CREW}/${ORDER}/../${FILE}.jpg`)).toBeNull();
    expect(orderIdOfPath(`customer/${CREW}/${FILE}.jpg`)).toBeNull();
  });

  it("attaches only a path inside the order's own folder", () => {
    const input = { orderId: ORDER, kind: "before", durationS: null };
    const path = jobObjectPath(CREW, ORDER, FILE, "image/jpeg");
    expect(attachJobMediaSchema.safeParse({ ...input, path }).success).toBe(true);
    expect(attachJobMediaSchema.safeParse({ ...input, orderId: FILE, path }).success).toBe(false);
    expect(attachJobMediaSchema.safeParse({ ...input, kind: "customer", path }).success).toBe(
      false,
    );
  });

  it("maps the database's answers", () => {
    expect(jobMediaErrorFor({ code: "ZL023" })).toBe("media_not_allowed");
    expect(jobMediaErrorFor({ code: "ZL008" })).toBe("too_many_files");
    expect(jobMediaErrorFor({ code: "ZL009" })).toBe("upload_not_found");
    expect(jobMediaErrorFor({ code: "P0002" })).toBe("not_found");
    expect(jobMediaErrorFor({ code: "XX000" })).toBe("failed");
    expect(crewJobErrorFor({ code: "ZL011", message: "sterilant_required" })).toBe(
      "sterilant_required",
    );
    expect(crewJobErrorFor({ code: "22023", message: "invalid_chlorine" })).toBe(
      "invalid_chlorine",
    );
    expect(crewJobErrorFor({ code: "22023", message: "other" })).toBe("failed");
  });
});

describe("the C4 form", () => {
  const form = { orderId: ORDER, cashCollected: true, residualChlorine: null, note: "" };
  const error = (input: object) => finishJobSchema.safeParse(input).error?.issues[0]?.message;

  it("reads the chlorine box", () => {
    expect(parseChlorine("")).toBeNull();
    expect(parseChlorine(" 0.5 ")).toBe(0.5);
    expect(parseChlorine("٠٫٥")).toBe(0.5);
    expect(parseChlorine("1,2")).toBe(1.2);
    expect(parseChlorine("abc")).toBeNaN();
    expect(parseChlorine("-1")).toBeNaN();
  });

  it("needs the sterilant and a reading in range", () => {
    expect(error({ ...form, sterilant: "  " })).toBe("sterilant_required");
    expect(error({ ...form, sterilant: "ك" })).toBe("invalid_sterilant");
    expect(error({ ...form, sterilant: "ك".repeat(121) })).toBe("invalid_sterilant");
    expect(error({ ...form, sterilant: "كلور", residualChlorine: Number.NaN })).toBe(
      "invalid_chlorine",
    );
    expect(error({ ...form, sterilant: "كلور", residualChlorine: 10.5 })).toBe("invalid_chlorine");
    expect(error({ ...form, sterilant: "كلور", residualChlorine: 0.55 })).toBe("invalid_chlorine");
    expect(error({ ...form, sterilant: "كلور", note: "ن".repeat(501) })).toBe("note_too_long");
    expect(error({ ...form, sterilant: "كلور", cashCollected: false })).toBe("cash_not_collected");
    expect(
      finishJobSchema.parse({ ...form, sterilant: " كلور ", residualChlorine: 0.3, note: " x " }),
    ).toMatchObject({ sterilant: "كلور", residualChlorine: 0.3, note: "x" });
  });
});

// The queue, with fake uploads, a memory store and a hand-driven clock.

type FakeUpload = {
  target: { path: string; uploadUrl: string | null };
  callbacks: TusCallbacks;
  started: boolean;
  aborted: boolean;
};

function setup({ store = memoryStore(), online = true } = {}) {
  const uploads: FakeUpload[] = [];
  const attached: string[] = [];
  const state = { online, now: 1000, attach: "done" as "done" | "offline" | "closed" };
  const timers: { at: number; run: () => void }[] = [];
  const deps: QueueDeps = {
    openStore: async () => store,
    deleteStore: vi.fn(async () => undefined),
    upload: async (_file, target, callbacks) => {
      const fake: FakeUpload = { target, callbacks, started: false, aborted: false };
      uploads.push(fake);
      return {
        start: () => {
          fake.started = true;
        },
        abort: async () => {
          fake.aborted = true;
        },
      };
    },
    prepare: async (file) => ({ file, durationS: file.type.startsWith("video/") ? 5 : null }),
    removeObject: vi.fn(async () => undefined),
    online: () => state.online,
    now: () => state.now,
    setTimer: (run, ms) => {
      const timer = { at: state.now + ms, run };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
  };
  const attach = vi.fn(async (input: { path: string }): Promise<AttachResult> => {
    if (state.attach === "offline") throw new Error("Failed to fetch");
    if (state.attach === "closed") return { status: "error", error: "media_not_allowed" };
    attached.push(input.path);
    return { status: "done", id: FILE };
  });
  return { deps, store, uploads, attached, attach, state, timers, queue: new MediaQueue(deps) };
}

const photo = () => new File([new Uint8Array(10)], "p.jpg", { type: "image/jpeg" });
const target = { crewId: CREW, orderId: ORDER, kind: "before" as const, room: 10 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("MediaQueue", () => {
  it("uploads, attaches and forgets a photo", async () => {
    const t = setup();
    await t.queue.start(USER_A, t.attach);
    await t.queue.add(USER_A, target, [photo()]);
    await flush();
    expect(t.uploads).toHaveLength(1);
    expect(t.uploads[0]?.started).toBe(true);
    expect(await t.store.all()).toHaveLength(1);

    t.uploads[0]?.callbacks.onSuccess();
    await flush();
    expect(t.attached).toEqual([t.uploads[0]?.target.path]);
    expect(t.queue.getItems(USER_A)[0]?.status).toBe("attached");
    expect(await t.store.all()).toEqual([]);
  });

  it("refuses the wrong kind of file and more than there is room for", async () => {
    const t = setup();
    await t.queue.start(USER_A, t.attach);
    const video = new File([new Uint8Array(10)], "v.webm", { type: "video/webm" });
    expect(await t.queue.add(USER_A, target, [video])).toEqual(["unsupported"]);
    expect(await t.queue.add(USER_A, { ...target, room: 1 }, [photo(), photo()])).toEqual([
      "too_many",
    ]);
    expect(t.queue.getItems(USER_A)).toHaveLength(1);
  });

  it("waits offline and starts when the browser is back", async () => {
    const t = setup({ online: false });
    await t.queue.start(USER_A, t.attach);
    await t.queue.add(USER_A, target, [photo()]);
    await flush();
    expect(t.uploads).toHaveLength(0);
    expect(t.queue.getItems(USER_A)[0]?.status).toBe("waiting");

    t.state.online = true;
    t.queue.wake();
    await flush();
    expect(t.uploads).toHaveLength(1);
  });

  it("resumes after a reload from the saved upload URL", async () => {
    const first = setup();
    await first.queue.start(USER_A, first.attach);
    await first.queue.add(USER_A, target, [photo()]);
    await flush();
    first.uploads[0]?.callbacks.onUrl?.("https://storage.test/upload/abc");
    await flush();

    // A new page: a new queue over the same store.
    const second = setup({ store: first.store });
    await second.queue.start(USER_A, second.attach);
    await flush();
    expect(second.uploads[0]?.target.uploadUrl).toBe("https://storage.test/upload/abc");
    second.uploads[0]?.callbacks.onSuccess();
    await flush();
    expect(second.attached).toHaveLength(1);
  });

  it("keeps a photo the page closed on while it was being prepared", async () => {
    const first = setup();
    first.deps.prepare = () => new Promise(() => undefined);
    await first.queue.start(USER_A, first.attach);
    void first.queue.add(USER_A, target, [photo()]);
    await flush();
    expect(first.queue.getItems(USER_A)[0]?.status).toBe("preparing");
    expect(await first.store.all()).toMatchObject([{ prepared: false }]);

    const second = setup({ store: first.store });
    await second.queue.start(USER_A, second.attach);
    await flush();
    expect(second.uploads).toHaveLength(1);
    second.uploads[0]?.callbacks.onSuccess();
    await flush();
    expect(second.attached).toHaveLength(1);
  });

  it("attaches again after a reload when only the attach was left", async () => {
    const first = setup();
    first.state.attach = "offline";
    await first.queue.start(USER_A, first.attach);
    await first.queue.add(USER_A, target, [photo()]);
    await flush();
    first.uploads[0]?.callbacks.onSuccess();
    await flush();
    expect(first.queue.getItems(USER_A)[0]?.status).toBe("waiting");

    const second = setup({ store: first.store });
    await second.queue.start(USER_A, second.attach);
    await flush();
    expect(second.uploads).toHaveLength(0);
    expect(second.attached).toHaveLength(1);
  });

  it("treats Storage's 'already there' as uploaded, and retries when there was no answer", async () => {
    const t = setup();
    await t.queue.start(USER_A, t.attach);
    await t.queue.add(USER_A, target, [photo()]);
    await flush();
    t.uploads[0]?.callbacks.onError(null);
    await flush();
    expect(t.queue.getItems(USER_A)[0]?.status).toBe("waiting");
    expect(t.timers).toHaveLength(1);

    t.state.now += 5000;
    t.timers[0]?.run();
    await flush();
    t.uploads[1]?.callbacks.onError(409);
    await flush();
    expect(t.attached).toHaveLength(1);
  });

  it("stops for good when the job no longer takes files", async () => {
    const t = setup();
    t.state.attach = "closed";
    await t.queue.start(USER_A, t.attach);
    await t.queue.add(USER_A, target, [photo()]);
    await flush();
    t.uploads[0]?.callbacks.onSuccess();
    await flush();
    expect(t.queue.getItems(USER_A)[0]).toMatchObject({
      status: "failed",
      error: "media_not_allowed",
    });
  });

  it("removes a file and deletes its uploaded copy", async () => {
    const t = setup();
    t.state.attach = "offline";
    await t.queue.start(USER_A, t.attach);
    await t.queue.add(USER_A, target, [photo()]);
    await flush();
    t.uploads[0]?.callbacks.onSuccess();
    await flush();
    const [item] = t.queue.getItems(USER_A);
    await t.queue.remove(USER_A, item?.id ?? "");
    expect(t.queue.getItems(USER_A)).toEqual([]);
    expect(await t.store.all()).toEqual([]);
    expect(t.deps.removeObject).toHaveBeenCalledWith(item?.path);
  });

  it("aborting a running upload doesn't stall the next one", async () => {
    const t = setup();
    await t.queue.start(USER_A, t.attach);
    await t.queue.add(USER_A, target, [photo(), photo()]);
    await flush();
    const [first] = t.queue.getItems(USER_A);
    await t.queue.remove(USER_A, first?.id ?? "");
    await flush();
    expect(t.uploads[0]?.aborted).toBe(true);
    expect(t.uploads[1]?.started).toBe(true);
  });

  it("never shows or keeps another account's files", async () => {
    const store: MediaStore = memoryStore();
    const a = setup({ store, online: false });
    await a.queue.start(USER_A, a.attach);
    await a.queue.add(USER_A, target, [photo()]);
    expect(a.queue.getItems(USER_A)).toHaveLength(1);

    // Same phone, another crew logs in (the session ran out, say).
    await a.queue.start(USER_B, a.attach);
    expect(a.queue.getItems(USER_B)).toEqual([]);
    expect(a.queue.getItems(USER_A)).toEqual([]);
    expect((await store.all()).map((file: StoredFile) => file.userId)).toEqual([]);
  });

  it("logout deletes everything", async () => {
    const t = setup({ online: false });
    await t.queue.start(USER_A, t.attach);
    await t.queue.add(USER_A, target, [photo()]);
    await t.queue.clear();
    expect(t.queue.getItems(USER_A)).toEqual([]);
    expect(t.deps.deleteStore).toHaveBeenCalled();
  });
});
