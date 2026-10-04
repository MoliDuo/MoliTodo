import { Settings as SettingsIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { MeResponse } from "@shared/api";
import { CompletedView } from "./components/CompletedView";
import { Conflicts } from "./components/Conflicts";
import { Settings } from "./components/Settings";
import { SyncBadge } from "./components/SyncBadge";
import { AddTask, TaskList } from "./components/TaskList";
import { signInUrl } from "./api";
import type { TodoStore } from "./store";

const REFRESH_MS = 60_000;
const SEND_DELAY_MS = 300;

export function TodoApp({
  store,
  me,
  now = Date.now,
}: {
  store: TodoStore;
  me: MeResponse;
  now?: () => number;
}) {
  const tick = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { engine } = store;
  const [view, setView] = useState<"todo" | "done">("todo");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Send changes shortly after they are made; also pull on start, when the tab comes back, and every minute.
  useEffect(() => {
    void engine.sync();
    const refresh = () => document.visibilityState !== "hidden" && void engine.sync();
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [engine]);

  const hasPending = Object.keys(engine.getState().pending).length > 0;
  const idle = engine.getStatus() !== "syncing";
  useEffect(() => {
    if (!hasPending || !idle) return;
    const timer = setTimeout(() => void engine.sync(), SEND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [engine, hasPending, idle, tick]);

  const status = engine.getStatus();
  useEffect(() => {
    if (status === "auth") window.location.assign(signInUrl(window.location));
  }, [status]);

  // The engine changes in place; `tick` re-renders this component, so the lists are read fresh each time.
  const todo = engine.list();
  const completed = engine.all().filter((task) => task.done);
  const doneCount = todo.filter((task) => task.done).length;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Moli Todo</h1>
        <div className="flex items-center gap-3">
          <SyncBadge
            status={status}
            lastSyncAt={engine.getState().lastSyncAt}
            onSync={() => void engine.sync()}
          />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="设置"
            className="text-muted hover:text-text"
          >
            <SettingsIcon size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <Conflicts engine={engine} />

      <nav className="flex gap-2" aria-label="视图">
        {(["todo", "done"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            aria-pressed={view === key}
            className={`rounded-full px-3 py-1 text-sm ${
              view === key ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted"
            }`}
          >
            {key === "todo" ? "待办" : "已完成"}
          </button>
        ))}
        {view === "todo" && doneCount > 0 && (
          <button
            type="button"
            onClick={() => engine.clearCompleted()}
            className="text-muted ml-auto text-sm"
          >
            清除已完成（{doneCount}）
          </button>
        )}
      </nav>

      <AddTask engine={engine} />
      {view === "todo" ? (
        <TaskList engine={engine} tasks={todo} />
      ) : (
        <CompletedView engine={engine} tasks={completed} now={now()} />
      )}

      {settingsOpen && (
        <Settings
          engine={engine}
          username={me.name ?? me.username}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
