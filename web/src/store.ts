import { createHttpTransport } from "@shared/http-transport";
import { SyncEngine, type SyncState, type SyncStatus, type Transport } from "@shared/sync";

export const WEB_CLIENT = `todo-web/${__APP_VERSION__}`;

/** The engine plus what React needs to follow it: a counter that changes whenever the engine's state does. */
export interface TodoStore {
  engine: SyncEngine;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

export interface StoreOptions {
  transport: Transport;
  /** A saved copy to start from (the desktop app keeps one on disk). */
  state?: SyncState;
  /** Called after every change, for saving. */
  onChange?: (state: SyncState, status: SyncStatus) => void;
}

export function createStore(options: StoreOptions): TodoStore {
  const listeners = new Set<() => void>();
  let tick = 0;
  const engine = new SyncEngine({
    transport: options.transport,
    ...(options.state ? { state: options.state } : {}),
    onChange: (state, status) => {
      tick += 1;
      options.onChange?.(state, status);
      listeners.forEach((listener) => listener());
    },
  });
  return {
    engine,
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
  return createStore({ transport: createHttpTransport({ client: WEB_CLIENT, fetch: fetchFn }) });
}
