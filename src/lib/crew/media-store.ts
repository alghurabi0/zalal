import type { JobMediaKind } from "./media";

// Where the crew's media queue keeps its files until they are attached
// (spec §8.1 C3b): IndexedDB, so a reload or a closed tab loses nothing.
// Every record carries the account it belongs to; the queue deletes other
// accounts' records when it starts, and logout deletes the whole database,
// so nothing from one crew stays on a shared phone for the next. When
// IndexedDB isn't there (some private windows), the queue keeps its files
// in memory instead, until the page is closed.

export type StoredFile = {
  id: string;
  userId: string;
  orderId: string;
  kind: JobMediaKind;
  /** Object name in order-media (crew/<crew>/<order>/<id>.<ext>). */
  path: string;
  contentType: string;
  bytes: number;
  durationS: number | null;
  /** The TUS upload's URL once Storage made it, to resume after a reload. */
  uploadUrl: string | null;
  /** Storage has the whole file; only the attach is left. */
  uploaded: boolean;
  createdAt: number;
  file: Blob;
};

export interface MediaStore {
  all(): Promise<StoredFile[]>;
  put(file: StoredFile): Promise<void>;
  delete(id: string): Promise<void>;
  close(): void;
}

const DB_NAME = "zl-crew-media";
const STORE = "files";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

class IdbStore implements MediaStore {
  constructor(private readonly db: IDBDatabase) {
    // Another tab's logout deletes the database: let it.
    db.onversionchange = () => db.close();
  }

  private store(mode: IDBTransactionMode) {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  all() {
    return request(this.store("readonly").getAll() as IDBRequest<StoredFile[]>);
  }

  async put(file: StoredFile) {
    await request(this.store("readwrite").put(file));
  }

  async delete(id: string) {
    await request(this.store("readwrite").delete(id));
  }

  close() {
    this.db.close();
  }
}

/** Keeps the files for as long as the page lives. */
export function memoryStore(): MediaStore {
  const files = new Map<string, StoredFile>();
  return {
    all: async () => [...files.values()],
    put: async (file) => {
      files.set(file.id, file);
    },
    delete: async (id) => {
      files.delete(id);
    },
    close: () => undefined,
  };
}

export async function openMediaStore(): Promise<MediaStore> {
  try {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(STORE, { keyPath: "id" });
    };
    return new IdbStore(await request(open));
  } catch {
    return memoryStore();
  }
}

/**
 * Deletes every queued file of every account (logout). Gives up after a few
 * seconds, so a stuck tab can't hold the logout.
 */
export function deleteMediaStore(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    try {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = done;
      req.onerror = done;
    } catch {
      done();
    }
  });
}
