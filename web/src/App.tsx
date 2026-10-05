import { useEffect, useState } from "react";
import type { MeResponse } from "@shared/api";
import { fetchMe, signInUrl, UnauthorizedError } from "./api";
import { openLocalCache, type LocalCache } from "./lib/local-cache";
import type { SyncState } from "./lib/sync";
import { createTodoStore, type TodoStore } from "./store";
import { Shell } from "./Shell";

type State =
  | { status: "loading" }
  | { status: "ready"; me: MeResponse; store: TodoStore }
  | { status: "error" };

const deviceCache = openLocalCache();
/** One function for the page's life: a new one on each render would start the app over each time. */
const browserFetch: typeof fetch = (...args) => fetch(...args);

/**
 * Opens from the copy on this device when there is one, so the list shows before the network answers; the
 * server then says who is signed in. A different person gets their own copy; no session goes back to sign-in.
 */
export function App({
  fetchFn = browserFetch,
  cache = deviceCache,
}: {
  fetchFn?: typeof fetch;
  cache?: LocalCache;
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let shown: { me: MeResponse; store: TodoStore } | null = null;
    const show = (me: MeResponse, saved: SyncState | null) => {
      const store =
        shown?.me.username === me.username
          ? shown.store
          : createTodoStore(fetchFn, {
              state: saved,
              save: (next) => cache.saveState(me.username, next),
            });
      shown = { me, store };
      setState({ status: "ready", me, store });
    };
    const flush = () => void cache.flush();
    const flushIfHidden = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushIfHidden);

    const asked = fetchMe(fetchFn);
    asked.catch(() => undefined);
    void (async () => {
      const saved = await cache.load();
      if (cancelled) return;
      if (saved) show(saved.me, saved.state);
      try {
        const me = await asked;
        void cache.saveMe(me);
        const state = await cache.loadState(me.username);
        if (!cancelled) show(me, state);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof UnauthorizedError) window.location.assign(signInUrl(window.location));
        else if (!shown) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flushIfHidden);
      flush();
    };
  }, [fetchFn, cache]);

  if (state.status === "ready")
    return <Shell key={state.me.username} store={state.store} me={state.me} />;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Moli Todo</h1>
      {state.status === "loading" && <p className="text-muted">加载中…</p>}
      {state.status === "error" && (
        <p role="alert" className="text-danger">
          加载失败，请刷新页面重试。
        </p>
      )}
    </main>
  );
}
