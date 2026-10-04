import { CheckCircle2, Circle, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { SyncEngine, ViewTask } from "../lib/sync";

/** Enter commits unless an input method is still composing (a Chinese IME uses Enter to pick a word). */
export const isCommitKey = (event: React.KeyboardEvent): boolean =>
  event.key === "Enter" && !event.nativeEvent.isComposing;

export function AddTask({ engine }: { engine: SyncEngine }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (engine.add(text)) setText("");
  };
  return (
    <input
      value={text}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => isCommitKey(event) && submit()}
      placeholder="添加任务，回车确认"
      aria-label="添加任务"
      maxLength={2000}
      className="border-border bg-surface focus:border-accent w-full rounded-lg border px-3 py-2 outline-none"
    />
  );
}

function EditableText(props: { task: ViewTask; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && draft !== null && draft.trim()) props.onSave(draft);
    setDraft(null);
  };
  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => {
          done.current = false;
          setDraft(props.task.text);
        }}
        className={`flex-1 text-left break-words ${props.task.done ? "text-muted line-through" : ""}`}
      >
        {props.task.text}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      aria-label="修改任务"
      maxLength={2000}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (isCommitKey(event)) finish(true);
        else if (event.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      className="border-accent bg-surface flex-1 rounded border px-2 py-0.5 outline-none"
    />
  );
}

export function TaskList({ engine, tasks }: { engine: SyncEngine; tasks: ViewTask[] }) {
  const [dragging, setDragging] = useState<string | null>(null);

  const drop = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    if (!dragging) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const lowerHalf = event.clientY > rect.top + rect.height / 2;
    const target = lowerHalf ? (tasks[index + 1]?.id ?? null) : (tasks[index]?.id ?? null);
    if (target !== dragging) engine.move(dragging, target);
    setDragging(null);
  };

  if (tasks.length === 0) return <p className="text-muted py-8 text-center">没有待办，真轻松。</p>;
  return (
    <ul className="flex flex-col gap-1">
      {tasks.map((task, index) => (
        <li
          key={task.id}
          draggable
          onDragStart={() => setDragging(task.id)}
          onDragEnd={() => setDragging(null)}
          onDragOver={(event) => dragging && event.preventDefault()}
          onDrop={(event) => drop(event, index)}
          className={`bg-surface border-border flex items-center gap-2 rounded-lg border px-3 py-2 ${
            dragging === task.id ? "opacity-50" : ""
          }`}
        >
          <button
            type="button"
            onClick={() => engine.toggle(task.id)}
            aria-label={task.done ? "标为未完成" : "标为完成"}
            aria-pressed={task.done}
            className={task.done ? "text-accent" : "text-muted"}
          >
            {task.done ? (
              <CheckCircle2 size={20} aria-hidden="true" />
            ) : (
              <Circle size={20} aria-hidden="true" />
            )}
          </button>
          <EditableText task={task} onSave={(text) => engine.update(task.id, { text })} />
          <button
            type="button"
            onClick={() => engine.removeFromList(task.id)}
            aria-label={`删除 ${task.text}`}
            className="text-muted hover:text-danger"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
