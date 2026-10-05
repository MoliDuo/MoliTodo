import { createHttpTransport } from "./lib/http-transport";
import { createFileApi, type FileApi } from "./lib/images";
import { SyncEngine, type Transport } from "./lib/sync";

export const WEB_CLIENT = `todo-web/${__APP_VERSION__}`;

/** The engine plus what React needs to follow it: a counter that changes whenever the engine's state does. */
export interface TodoStore {
  engine: SyncEngine;
  /** Pictures attached to lines; they go to the server directly, not through the sync engine. */
  files: FileApi;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

function createStore(transport: Transport, files: FileApi): TodoStore {
  const listeners = new Set<() => void>();
  let tick = 0;
  const engine = new SyncEngine({
    transport,
    onChange: () => {
      tick += 1;
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
 * The website keeps its copy in memory only: the browser is online whenever the page is useful, and
 * every change is sent right away (standard 009, 9.7: no offline queue on the web).
 */
export function createTodoStore(fetchFn: typeof fetch = (...args) => fetch(...args)): TodoStore {
  return createStore(
    createHttpTransport({ client: WEB_CLIENT, fetch: fetchFn }),
    createFileApi(WEB_CLIENT, fetchFn)
  );
}
