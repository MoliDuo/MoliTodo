import { createHttpTransport } from "./lib/http-transport";
import { createFileApi, type FileApi } from "./lib/images";
import { SyncEngine, type SyncState, type Transport } from "./lib/sync";

export const WEB_CLIENT = `todo-web/${__APP_VERSION__}`;

/** The engine plus what React needs to follow it: a counter that changes whenever the engine's state does. */
export interface TodoStore {
  engine: SyncEngine;
  /** Pictures attached to lines; they go to the server directly, not through the sync engine. */
  files: FileApi;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

export interface StoreOptions {
  /** Where to start from: the copy kept on this device. */
  state?: SyncState | null;
  /** Called after every change, to keep the copy on this device. */
  save?: (state: SyncState) => void;
}

function createStore(transport: Transport, files: FileApi, options: StoreOptions): TodoStore {
  const listeners = new Set<() => void>();
  let tick = 0;
  const engine = new SyncEngine({
    transport,
    ...(options.state ? { state: options.state } : {}),
    onChange: (state) => {
      tick += 1;
      options.save?.(state);
      listeners.forEach((listener) => listener());
    },
  });
  return {
    engine,
    files,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => tick,
  };
}

/**
 * Every change is sent right away. The copy is also kept on this device (`lib/local-cache.ts`), so the app
 * opens without the network and changes made offline are sent once it is back, even after the page was closed.
 */
export function createTodoStore(
  fetchFn: typeof fetch = (...args) => fetch(...args),
  options: StoreOptions = {}
): TodoStore {
  return createStore(
    createHttpTransport({ client: WEB_CLIENT, fetch: fetchFn }),
    createFileApi(WEB_CLIENT, fetchFn),
    options
  );
}
