import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { MeResponse } from "@shared/api";
import { fetchMe, signInUrl, UnauthorizedError } from "./api";

type State = { status: "loading" } | { status: "ready"; me: MeResponse } | { status: "error" };

export function App({ fetchFn = fetch }: { fetchFn?: typeof fetch }) {
  const [state, setState] = useState<State>({ status: "loading" });

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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <CheckCircle2 className="text-accent" aria-hidden="true" />
        Moli Todo
      </h1>
      {state.status === "loading" && <p className="text-muted">加载中…</p>}
      {state.status === "error" && (
        <p role="alert" className="text-danger">
          加载失败，请刷新页面重试。
        </p>
      )}
      {state.status === "ready" && (
        <p>
          已登录：<strong>{state.me.name ?? state.me.username}</strong>
        </p>
      )}
    </main>
  );
}
