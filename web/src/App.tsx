import { useEffect, useState } from "react";
import type { MeResponse } from "@shared/api";
import { fetchMe, signInUrl, UnauthorizedError } from "./api";
import { createTodoStore, type TodoStore } from "./store";
import { TodoApp } from "./TodoApp";

type State = { status: "loading" } | { status: "ready"; me: MeResponse } | { status: "error" };

export function App({ fetchFn = (...args) => fetch(...args) }: { fetchFn?: typeof fetch }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [store] = useState<TodoStore>(() => createTodoStore(fetchFn));

  useEffect(() => {
    let cancelled = false;
    fetchMe(fetchFn).then(
      (me) => !cancelled && setState({ status: "ready", me }),
      (error: unknown) => {
        if (cancelled) return;
        if (error instanceof UnauthorizedError) window.location.assign(signInUrl(window.location));
        else setState({ status: "error" });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [fetchFn]);

  if (state.status === "ready") return <TodoApp store={store} me={state.me} />;
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
