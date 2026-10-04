import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { isValidTagName, tagKey } from "@shared/tags";
import { ColorPicker } from "../components/ColorPicker";
import { Sheet } from "../components/Sheet";
import { TaskLine } from "../components/TaskText";
import { useApp } from "../context";
import {
  groupByDay,
  renameTagEverywhere,
  setTagColor,
  tagColor,
  tagSummaries,
  tasksWithTag,
  totalMinutes,
} from "../lib/model";
import { formatDuration, formatFullDay } from "../lib/time";
import { navigate } from "../router";
import { useTagColors } from "../useTagColors";

function TagSettings({ name, onClose }: { name: string; onClose: () => void }) {
  const { engine } = useApp();
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const others = tagSummaries(engine).filter((t) => t.key !== tagKey(name));
  const rename = () => {
    const next = draft.trim().replace(/^#/, "");
    if (next === name) return onClose();
    if (!isValidTagName(next)) return setError("标签不能有空格、# 和标点");
    if (
      others.some((t) => t.key === tagKey(next)) &&
      !window.confirm(`已经有 #${next}，合并到一起吗？`)
    )
      return;
    renameTagEverywhere(engine, name, next);
    onClose();
    navigate({ name: "tag", tag: next }, true);
  };
  return (
    <Sheet title={`#${name}`} onClose={onClose}>
      <section className="mb-6">
        <h3 className="text-muted mb-2 text-xs">改名（所有写了它的任务一起改）</h3>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            rename();
          }}
        >
          <span className="bg-surface-2 flex min-w-0 flex-1 items-center rounded-lg px-3">
            <span className="text-muted">#</span>
            <input
              value={draft}
              aria-label="标签名"
              aria-invalid={error !== null}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
            />
          </span>
          <button type="submit" className="bg-accent text-accent-fg rounded-lg px-4 text-sm">
            改名
          </button>
        </form>
        {error && <p className="text-danger mt-1 text-xs">{error}</p>}
      </section>
      <section>
        <h3 className="text-muted mb-2 text-xs">颜色</h3>
        <ColorPicker
          value={tagColor(engine, name)}
          noneLabel="跟主题色"
          onChange={(color) => setTagColor(engine, name, color)}
        />
      </section>
    </Sheet>
  );
}

export function TagPage({ tag }: { tag: string }) {
  const { engine, tick, today } = useApp();
  const tagColors = useTagColors();
  const [settings, setSettings] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tasks = useMemo(() => tasksWithTag(engine, tag), [engine, tag, tick]);
  const groups = groupByDay(tasks).reverse();
  const done = tasks.filter((t) => t.data.done).length;
  const minutes = totalMinutes(tasks);
  const share = tasks.length === 0 ? 0 : done / tasks.length;
  const color = tagColors.get(tagKey(tag)) ?? "var(--moli-accent)";

  return (
    <div className="mx-auto max-w-2xl px-5 lg:px-10">
      <header className="flex items-center gap-3 pt-4 pb-3">
        <button
          type="button"
          aria-label="返回"
          onClick={() =>
            window.history.length > 1
              ? window.history.back()
              : navigate({ name: "index", query: "" })
          }
          className="hover:bg-surface-2 -ml-2 rounded-full p-2"
        >
          <ArrowLeft size={22} aria-hidden="true" />
        </button>
        <h1 className="min-w-0 flex-1 truncate font-serif text-xl font-semibold">#{tag}</h1>
        <button
          type="button"
          aria-label="标签设置"
          onClick={() => setSettings(true)}
          className="hover:bg-surface-2 -mr-2 rounded-full p-2"
        >
          <MoreHorizontal size={20} aria-hidden="true" />
        </button>
      </header>

      <section className="border-border border-b pb-5">
        <div className="flex items-baseline justify-between">
          <p>
            <b className="font-serif text-3xl">{tasks.length}</b>{" "}
            <span className="text-muted text-sm">条</span>
          </p>
          <p className="text-muted text-sm">
            共用时{" "}
            <b className="text-text font-serif text-lg font-semibold">{formatDuration(minutes)}</b>
          </p>
        </div>
        <div
          className="bg-surface-2 mt-3 h-2.5 overflow-hidden rounded-full"
          role="progressbar"
          aria-label="完成比例"
          aria-valuenow={Math.round(share * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${share * 100}%`, background: color }}
          />
        </div>
        <p className="text-muted mt-2 flex gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
            完成 {done}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="bg-border h-2 w-2 rounded-sm" />
            未完成 {tasks.length - done}
          </span>
        </p>
      </section>

      {tasks.length === 0 && (
        <p className="text-muted py-10 text-center text-sm">没有写着 #{tag} 的任务</p>
      )}
      {groups.map((group) => (
        <section key={group.day} className="pt-4">
          <div className="text-muted mb-1.5 flex items-center justify-between text-xs">
            <button
              type="button"
              className="hover:text-accent-ink"
              onClick={() =>
                navigate({ name: "today", day: group.day === today ? null : group.day })
              }
            >
              {formatFullDay(group.day, today)}
            </button>
            {totalMinutes(group.tasks) > 0 && (
              <span className="font-serif">{formatDuration(totalMinutes(group.tasks))}</span>
            )}
          </div>
          <div className="space-y-1">
            {group.tasks.map((task) => (
              <TaskLine
                key={task.id}
                task={task.data}
                tagColors={tagColors}
                onOpen={() =>
                  navigate({ name: "today", day: task.data.day === today ? null : task.data.day })
                }
              />
            ))}
          </div>
        </section>
      ))}
      {settings && <TagSettings name={tag} onClose={() => setSettings(false)} />}
    </div>
  );
}
