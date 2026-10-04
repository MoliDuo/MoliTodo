import { useEffect, useState, useSyncExternalStore } from "react";

/** The time, refreshed every `intervalMs` (and when the page comes back into view). */
export function useNow(clock: () => number, intervalMs: number): number {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const refresh = () => setNow(clock());
    const timer = setInterval(refresh, intervalMs);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [clock, intervalMs]);
  return now;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener("change", listener);
      return () => list?.removeEventListener("change", listener);
    },
    () => window.matchMedia?.(query).matches ?? false
  );
}

/** A value kept in this browser only (a remembered choice, never data that must sync). */
export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or storage off: the choice is just not remembered.
  }
}
