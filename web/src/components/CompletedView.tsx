import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { SyncEngine, ViewTask } from "@shared/sync";
import {
  formatClock,
  formatDayLabel,
  formatDuration,
  groupCompletedByDay,
  moveToDay,
  parseDateInputValue,
  parseDuration,
  toDateInputValue,
} from "@shared/time";
import { isCommitKey } from "./TaskList";

function DurationField({ task, onSave }: { task: ViewTask; onSave: (minutes: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const minutes = parseDuration(draft);
    if (minutes === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(null);
    onSave(minutes);
  };
  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(task.duration > 0 ? String(task.duration) : "")}
        className="text-muted hover:text-text text-xs"
        aria-label={`耗时 ${task.text}`}
      >
        {task.duration > 0 ? formatDuration(task.duration) : "记耗时"}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      aria-label="耗时"
      aria-invalid={invalid}
      placeholder="如 45、1h30m、1:30"
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (isCommitKey(event)) commit();
        else if (event.key === "Escape") setDraft(null);
      }}
      onBlur={() => (invalid ? setDraft(null) : commit())}
      className={`bg-surface w-32 rounded border px-2 py-0.5 text-xs outline-none ${
        invalid ? "border-danger" : "border-accent"
      }`}
    />
  );
}

export function CompletedView({
  engine,
  tasks,
  now,
}: {
  engine: SyncEngine;
  tasks: ViewTask[];
  now: number;
}) {
  const groups = groupCompletedByDay(tasks);
  if (groups.length === 0) return <p className="text-muted py-8 text-center">还没有完成的任务。</p>;
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section
          key={group.key}
          aria-label={
            group.dayStart === null ? "完成时间未知" : formatDayLabel(group.dayStart, now)
          }
        >
          <h2 className="text-muted mb-1 flex justify-between text-sm font-medium">
            <span>
              {group.dayStart === null ? "完成时间未知" : formatDayLabel(group.dayStart, now)}
            </span>
            {group.total > 0 && <span>{formatDuration(group.total)}</span>}
          </h2>
          <ul className="flex flex-col gap-1">
            {group.tasks.map((task) => (
              <li
                key={task.id}
                className="bg-surface border-border flex items-center gap-2 rounded-lg border px-3 py-2"
              >
                <span className="flex-1 break-words">{task.text}</span>
                {task.doneAt !== null && (
                  <span className="text-muted text-xs">{formatClock(task.doneAt)}</span>
                )}
                <input
                  type="date"
                  value={task.doneAt === null ? "" : toDateInputValue(task.doneAt)}
                  max={toDateInputValue(now)}
                  aria-label={`完成日期 ${task.text}`}
                  onChange={(event) => {
                    const day = parseDateInputValue(event.target.value);
                    if (day !== null)
                      engine.update(task.id, { doneAt: moveToDay(task.doneAt, day, now) });
                  }}
                  className="text-muted bg-transparent text-xs"
                />
                <DurationField
                  task={task}
                  onSave={(duration) => engine.update(task.id, { duration })}
                />
                <button
                  type="button"
                  onClick={() => engine.remove(task.id)}
                  aria-label={`删除 ${task.text}`}
                  className="text-muted hover:text-danger"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
