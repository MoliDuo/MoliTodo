import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { HIGHLIGHTS, type Highlight } from "@shared/records";
import { useApp } from "../context";
import {
  deleteTask,
  moveTask,
  moveTasksToDay,
  setHighlight,
  tasksOfDay,
  updateTask,
  type Task,
} from "../lib/model";
import { addDays, dayStart, formatDuration, parseDuration, relativeDay } from "../lib/time";
import { Sheet } from "./Sheet";

const HIGHLIGHT_NAMES: Record<Highlight, string> = {
  yellow: "黄色",
  red: "红色",
  blue: "蓝色",
  green: "绿色",
  purple: "紫色",
};

/** Everything that can be done to one line: highlight, time spent, another day, order, delete. */
export function TaskMenu({ task, onClose }: { task: Task; onClose: () => void }) {
  const { engine, today } = useApp();
  const [time, setTime] = useState(
    task.data.duration === null ? "" : formatDuration(task.data.duration)
  );
  const [badTime, setBadTime] = useState(false);
  const [pickDay, setPickDay] = useState(false);
  const day = task.data.day;
  const list = tasksOfDay(engine, day);
  const index = list.findIndex((t) => t.id === task.id);

  const saveTime = () => {
    if (time.trim() === "") {
      updateTask(engine, task.id, { duration: null });
      return onClose();
    }
    const minutes = parseDuration(time);
    if (minutes === null) return setBadTime(true);
    updateTask(engine, task.id, { duration: minutes });
    onClose();
  };
  const moveTo = (target: string) => {
    moveTasksToDay(engine, [task.id], target);
    onClose();
  };
  const targets = [today, addDays(today, 1)].filter((d) => d !== day);

  return (
    <Sheet title={task.data.text.trim() || "这一行"} onClose={onClose}>
      <section className="mb-5">
        <h3 className="text-muted mb-2 text-xs">高亮</h3>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="不高亮"
            aria-pressed={task.data.highlight === null}
            onClick={() => setHighlight(engine, task.id, null)}
            className={`border-border flex h-8 w-8 items-center justify-center rounded-full border text-xs ${
              task.data.highlight === null ? "ring-text ring-2 ring-offset-2" : ""
            }`}
          >
            无
          </button>
          {HIGHLIGHTS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={HIGHLIGHT_NAMES[color]}
              aria-pressed={task.data.highlight === color}
              onClick={() => setHighlight(engine, task.id, color)}
              className={`hl-${color} h-8 w-8 rounded-full ${
                task.data.highlight === color ? "ring-text ring-2 ring-offset-2" : ""
              }`}
            />
          ))}
        </div>
      </section>

      <section className="mb-5">
        <h3 className="text-muted mb-2 text-xs">用时</h3>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            saveTime();
          }}
        >
          <input
            value={time}
            onChange={(event) => {
              setTime(event.target.value);
              setBadTime(false);
            }}
            aria-label="用时"
            aria-invalid={badTime}
            placeholder="如 1h13min、45、1:30"
            className={`bg-surface-2 min-w-0 flex-1 rounded-lg px-3 py-2 font-serif text-sm outline-none ${
              badTime ? "ring-danger ring-1" : "focus:ring-accent focus:ring-1"
            }`}
          />
          <button type="submit" className="bg-accent text-accent-fg rounded-lg px-4 text-sm">
            保存
          </button>
        </form>
        {badTime && <p className="text-danger mt-1 text-xs">看不懂这个时间，试试 1h13min 或 45</p>}
      </section>

      <section className="mb-5">
        <h3 className="text-muted mb-2 text-xs">移到</h3>
        <div className="flex flex-wrap gap-2">
          {targets.map((target) => (
            <button
              key={target}
              type="button"
              onClick={() => moveTo(target)}
              className="bg-surface-2 hover:bg-border rounded-full px-4 py-1.5 text-sm"
            >
              {relativeDay(target, today)}
            </button>
          ))}
          {pickDay ? (
            <input
              type="date"
              autoFocus
              aria-label="选择日期"
              defaultValue={day}
              onChange={(event) =>
                dayStart(event.target.value) !== null && moveTo(event.target.value)
              }
              className="bg-surface-2 rounded-full px-3 py-1 text-sm"
            />
          ) : (
            <button
              type="button"
              onClick={() => setPickDay(true)}
              className="bg-surface-2 hover:bg-border rounded-full px-4 py-1.5 text-sm"
            >
              选日期…
            </button>
          )}
        </div>
      </section>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={index <= 0}
          onClick={() => moveTask(engine, task.id, list[index - 1]?.id ?? null)}
          className="bg-surface-2 hover:bg-border flex items-center gap-1 rounded-full px-3 py-1.5 text-sm disabled:opacity-40"
        >
          <ArrowUp size={14} aria-hidden="true" /> 上移
        </button>
        <button
          type="button"
          disabled={index < 0 || index >= list.length - 1}
          onClick={() => moveTask(engine, task.id, list[index + 2]?.id ?? null)}
          className="bg-surface-2 hover:bg-border flex items-center gap-1 rounded-full px-3 py-1.5 text-sm disabled:opacity-40"
        >
          <ArrowDown size={14} aria-hidden="true" /> 下移
        </button>
        <button
          type="button"
          onClick={() => {
            deleteTask(engine, task.id);
            onClose();
          }}
          className="text-danger hover:bg-danger/10 ml-auto flex items-center gap-1 rounded-full px-3 py-1.5 text-sm"
        >
          <Trash2 size={14} aria-hidden="true" /> 删除
        </button>
      </div>
    </Sheet>
  );
}
