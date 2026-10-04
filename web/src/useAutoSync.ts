import { useEffect, useSyncExternalStore } from "react";
import type { TodoStore } from "./store";

const SEND_DELAY_MS = 300;

export interface AutoSyncOptions {
  /** How often to pull while the page or window is in view. */
  refreshMs: number;
  /** Called when the server says the sign-in is no longer valid. */
  onAuthLost?: () => void;
  /** Called when the server says this version is too old (426). */
  onUpgradeRequired?: () => void;
}

/**
 * Keeps a store in sync: once on start, shortly after local changes, when the page comes back into view or
 * the network returns, and on a timer. Returns the change counter so the caller re-renders with the store.
 */
export function useAutoSync(store: TodoStore, options: AutoSyncOptions): number {
  const tick = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { engine } = store;
  const { refreshMs, onAuthLost, onUpgradeRequired } = options;

  useEffect(() => {
    void engine.sync();
    const refresh = () => document.visibilityState !== "hidden" && void engine.sync();
    const timer = setInterval(refresh, refreshMs);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [engine, refreshMs]);

  const hasPending = Object.keys(engine.getState().pending).length > 0;
  const status = engine.getStatus();
  const idle = status !== "syncing";
  // A change made while offline or signed out is retried by the timer and the triggers above, not in a loop here.
  const sendable = status === "idle";
  useEffect(() => {
    if (!hasPending || !idle || !sendable) return;
    const timer = setTimeout(() => void engine.sync(), SEND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [engine, hasPending, idle, sendable, tick]);

  useEffect(() => {
    if (status === "auth") onAuthLost?.();
    if (status === "upgrade") onUpgradeRequired?.();
  }, [status, onAuthLost, onUpgradeRequired]);

  return tick;
}
