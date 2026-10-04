import { useState } from "react";
import type { SyncEngine } from "@shared/sync";
import { CompletedView } from "./CompletedView";
import { Conflicts } from "./Conflicts";
import { AddTask, TaskList } from "./TaskList";

/** The part of the screen the website shows: view tabs, add box, the lists. */
export function TodoBody({ engine, now }: { engine: SyncEngine; now: number }) {
  const [view, setView] = useState<"todo" | "done">("todo");
  // The engine changes in place; the page re-renders on every change, so the lists are read fresh each time.
  const todo = engine.list();
  const completed = engine.all().filter((task) => task.done);
  const doneCount = todo.filter((task) => task.done).length;

  return (
    <>
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
        <CompletedView engine={engine} tasks={completed} now={now} />
      )}
    </>
  );
}
