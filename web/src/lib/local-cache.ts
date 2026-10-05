// The copy kept on this device (IndexedDB), so the app opens at once, works without a network, and keeps
// changes not sent yet when it is closed. The server stays authoritative: this is only where the sync engine
// starts from. Each person's copy is kept under their own name.

import { meResponseSchema, type MeResponse } from "@shared/api";
import type { SyncState } from "./sync";

const DB_NAME = "moli-todo";
const STORE = "state";
/** Raise when what is saved changes shape; a copy saved in another shape is ignored. */
const FORMAT = 1;
const SAVE_DELAY_MS = 300;

export interface Saved {
  me: MeResponse;
  state: SyncState | null;
}

export interface LocalCache {
  /** The person last signed in on this device, with their copy; null when there is none. */
  load(): Promise<Saved | null>;
  /** One person's copy; null when there is none. */
  loadState(username: string): Promise<SyncState | null>;
  saveMe(me: MeResponse): Promise<void>;
  /** Saved shortly after the last call, so a burst of changes is written once. */
  saveState(username: string, state: SyncState): void;
  /** Writes a waiting save now (the page is going away). */
  flush(): Promise<void>;
}

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

function open(factory: IDBFactory): Promise<IDBDatabase> {
  const req = factory.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  return request(req);
}

const isState = (value: unknown): value is SyncState => {
  const state = value as SyncState | null;
  return (
    typeof state === "object" &&
    state !== null &&
    typeof state.records === "object" &&
    typeof state.pending === "object" &&
    typeof state.cursor === "number" &&
    Array.isArray(state.conflicts)
  );
};

/** Every failure (no IndexedDB, private mode, a full disk) reads as "nothing saved"; the app then loads as before. */
export function openLocalCache(factory: IDBFactory | undefined = globalThis.indexedDB): LocalCache {
  let db: Promise<IDBDatabase | null> | null = null;
  const database = () =>
    (db ??= factory
      ? Promise.resolve(factory)
          .then(open)
          .catch(() => null)
      : Promise.resolve(null));

  async function get(key: string): Promise<unknown> {
    const conn = await database();
    if (!conn) return null;
    try {
      const saved = (await request(conn.transaction(STORE).objectStore(STORE).get(key))) as
        { format?: number; value?: unknown } | undefined;
      return saved?.format === FORMAT ? saved.value : null;
    } catch {
      return null;
    }
  }

  async function put(key: string, value: unknown): Promise<void> {
    const conn = await database();
    if (!conn) return;
    try {
      const tx = conn.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ format: FORMAT, value }, key);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } catch {
      // Not kept this time; the next change tries again.
    }
  }

  const stateKey = (username: string) => `sync:${username}`;

  async function loadState(username: string): Promise<SyncState | null> {
    const state = await get(stateKey(username));
    return isState(state) ? state : null;
  }

  let waiting: { username: string; state: SyncState } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    const save = waiting;
    waiting = null;
    if (save) await put(stateKey(save.username), save.state);
  }

  return {
    async load() {
      const me = meResponseSchema.safeParse(await get("me"));
      if (!me.success) return null;
      return { me: me.data, state: await loadState(me.data.username) };
    },
    loadState,
    saveMe: (me) => put("me", me),
    saveState(username, state) {
      if (waiting && waiting.username !== username) void flush();
      waiting = { username, state };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    flush,
  };
}
