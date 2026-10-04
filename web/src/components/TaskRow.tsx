import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useApp } from "../context";
import { clampIndent, deleteTask, toggleTask, updateTask, type Task } from "../lib/model";
import { formatDuration, parseDuration } from "../lib/time";
import { TaskMark, TaskWords, type TagColors } from "./TaskText";

export const INDENT_PX = 24;
const SAVE_DELAY_MS = 700;
const LONG_PRESS_MS = 480;
/** Two spaces (or one full-width space from a Chinese keyboard) at the start of a line indent it. */
const INDENT_PREFIX = /^(?: {2}|\u3000)/;

export interface FocusRequest {
  /** A task id, or "new" for the line at the bottom. */
  id: string;
  caret: number | "end";
  seq: number;
}

export interface LineActions {
  /** Moves the caret to another line. */
  focus: (id: string, caret: number | "end") => void;
  /**
   * Enter with the caret between `before` and `rest`: `rest` goes to a new line below. At the very start of a
   * line, an empty line opens above instead.
   */
  split: (task: Task, before: string, rest: string) => void;
  /** Backspace on an empty line: it goes, and the caret moves to the line above. */
  removeEmpty: (task: Task) => void;
  openMenu: (task: Task) => void;
  ticked: (task: Task, done: boolean) => void;
}

interface EditorKeys {
  value: string;
  indent: number;
  setIndent: (indent: number) => void;
  onEnter: (before: string, rest: string) => void;
  onBackspaceEmpty: () => void;
  onUp: () => void;
  onDown: () => void;
}

/** Keys shared by task lines and the new-line input: Enter, Backspace at the start, Tab, arrows. */
function handleKeys(event: KeyboardEvent<HTMLTextAreaElement>, keys: EditorKeys) {
  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
  const area = event.currentTarget;
  const atStart = area.selectionStart === 0 && area.selectionEnd === 0;
  const atEnd = area.selectionStart === keys.value.length;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    keys.onEnter(keys.value.slice(0, area.selectionStart), keys.value.slice(area.selectionEnd));
  } else if (event.key === "Backspace" && atStart) {
    if (keys.indent > 0) {
      event.preventDefault();
      keys.setIndent(keys.indent - 1);
    } else if (keys.value === "") {
      event.preventDefault();
      keys.onBackspaceEmpty();
    }
  } else if (event.key === "Tab") {
    event.preventDefault();
    keys.setIndent(clampIndent(keys.indent + (event.shiftKey ? -1 : 1)));
  } else if (event.key === "ArrowUp" && atStart) {
    event.preventDefault();
    keys.onUp();
  } else if (event.key === "ArrowDown" && atEnd) {
    event.preventDefault();
    keys.onDown();
  }
}

/** Typed text with leading indent spaces taken off: how many levels they were worth and the rest. */
function takeIndent(value: string): { levels: number; text: string } {
  let text = value;
  let levels = 0;
  let match: RegExpExecArray | null;
  while ((match = INDENT_PREFIX.exec(text))) {
    text = text.slice(match[0].length);
    levels += 1;
  }
  return { levels, text };
}

/** Focuses the textarea when a focus request names it. */
function useFocusRequest(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  id: string,
  request: FocusRequest | null
) {
  useEffect(() => {
    const area = ref.current;
    if (!area || !request || request.id !== id) return;
    area.focus({ preventScroll: false });
    const caret = request.caret === "end" ? area.value.length : request.caret;
    area.setSelectionRange(caret, caret);
    // Only a new request moves the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.seq]);
}

/** Long press (touch) calls `onLong`; a short tap calls `onTap`. */
function useLongPress(onLong: () => void, onTap: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (event: React.PointerEvent) => {
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      clear();
      timer.current = setTimeout(() => {
        fired.current = true;
        onLong();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 8) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onClick: () => {
      if (!fired.current) onTap();
    },
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      clear();
      if (!fired.current) onLong();
      fired.current = true;
    },
  };
}

/** The inline "how long did it take" box after a finished line. */
export function DurationInput({
  initial,
  onDone,
}: {
  initial: number | null;
  onDone: (minutes: number | null | undefined) => void;
}) {
  const [value, setValue] = useState(initial === null ? "" : formatDuration(initial));
  const [bad, setBad] = useState(false);
  const save = () => {
    if (value.trim() === "") return onDone(null);
    const minutes = parseDuration(value);
    if (minutes === null) {
      setBad(true);
      return;
    }
    onDone(minutes);
  };
  return (
    <input
      autoFocus
      value={value}
      aria-label="用时"
      aria-invalid={bad}
      placeholder="用时 如 1h13min"
      onChange={(event) => {
        setValue(event.target.value);
        setBad(false);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") save();
        if (event.key === "Escape") onDone(undefined);
      }}
      onBlur={() => (parseDuration(value) === null && value.trim() ? onDone(undefined) : save())}
      className={`bg-surface-2 ml-2 inline-block w-32 rounded-md px-2 py-0.5 align-baseline font-serif text-sm outline-none ${
        bad ? "ring-danger ring-1" : "focus:ring-accent ring-1 ring-transparent"
      }`}
    />
  );
}

export function TaskRow({
  task,
  tagColors,
  focusRequest,
  actions,
  prevId,
  nextId,
  showTimeHint,
  now,
}: {
  task: Task;
  tagColors: TagColors;
  focusRequest: FocusRequest | null;
  actions: LineActions;
  prevId: string | null;
  nextId: string;
  showTimeHint: boolean;
  now: number;
}) {
  const { engine } = useApp();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.data.text);
  const [askTime, setAskTime] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const text = editing ? draft : task.data.text;
  const { done, indent, highlight, duration } = task.data;

  useFocusRequest(ref, task.id, focusRequest);

  const save = (value: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    updateTask(engine, task.id, { text: value });
  };
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  const setIndent = (next: number) => updateTask(engine, task.id, { indent: next });

  const enter = (before: string, rest: string) => {
    if (before === "" && rest === "" && indent > 0) {
      setIndent(indent - 1);
      return;
    }
    if (before !== "") {
      setDraft(before);
      save(before);
    }
    actions.split(task, before, rest);
  };

  const onChange = (raw: string, caret: number) => {
    // A soft keyboard may type the line break itself instead of sending Enter.
    const lineBreak = raw.indexOf("\n");
    if (lineBreak >= 0) {
      enter(raw.slice(0, lineBreak), raw.slice(lineBreak + 1).replace(/\n/g, ""));
      return;
    }
    const { levels, text: value } = takeIndent(raw);
    if (levels > 0) {
      setIndent(clampIndent(indent + levels));
      requestAnimationFrame(() => {
        const start = Math.max(0, caret - (raw.length - value.length));
        ref.current?.setSelectionRange(start, start);
      });
    }
    setDraft(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(value), SAVE_DELAY_MS);
  };

  const tick = () => {
    const nowDone = toggleTask(engine, task.id, now);
    actions.ticked(task, nowDone);
  };
  const press = useLongPress(
    () => actions.openMenu(task),
    () => tick()
  );

  return (
    <li
      className="group relative flex items-start gap-3 py-[5px] pr-1"
      style={{ paddingLeft: indent * INDENT_PX }}
      onContextMenu={(event) => {
        if (event.target === ref.current) return;
        event.preventDefault();
        actions.openMenu(task);
      }}
    >
      <button
        type="button"
        aria-label={done ? "标为未完成" : "标为完成"}
        aria-pressed={done}
        className="flex h-6 w-5 shrink-0 touch-manipulation items-center justify-center select-none"
        {...press}
      >
        <TaskMark done={done} />
      </button>
      <div
        className={`min-w-0 flex-1 text-[15px] leading-6 ${done ? "text-muted" : ""}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) ref.current?.focus();
        }}
      >
        <span className="line-edit max-w-full min-w-[2em] align-top">
          <span aria-hidden="true">
            <TaskWords text={text} highlight={highlight} tagColors={tagColors} muted={done} />
            {"​"}
          </span>
          <textarea
            ref={ref}
            rows={1}
            value={text}
            aria-label="任务"
            spellCheck={false}
            className={done ? "caret-[var(--moli-muted)]" : ""}
            onFocus={() => {
              setDraft(task.data.text);
              setEditing(true);
            }}
            onBlur={() => {
              setEditing(false);
              if (draft.trim() === "") deleteTask(engine, task.id);
              else if (draft !== task.data.text) save(draft);
            }}
            onChange={(event) => onChange(event.target.value, event.target.selectionStart)}
            onKeyDown={(event) =>
              handleKeys(event, {
                value: text,
                indent,
                setIndent,
                onEnter: enter,
                onBackspaceEmpty: () => actions.removeEmpty(task),
                onUp: () => prevId && actions.focus(prevId, "end"),
                onDown: () => actions.focus(nextId, 0),
              })
            }
          />
        </span>
        {done && duration !== null && !askTime && (
          <button
            type="button"
            onClick={() => setAskTime(true)}
            className="text-muted ml-2 align-top font-serif text-[14px] whitespace-nowrap"
            aria-label={`用时 ${formatDuration(duration)}，点击修改`}
          >
            {formatDuration(duration)}
          </button>
        )}
        {done && duration === null && !askTime && (
          <button
            type="button"
            onClick={() => setAskTime(true)}
            className={`text-accent-ink/80 hover:text-accent-ink ml-2 align-top text-xs whitespace-nowrap transition-opacity ${
              showTimeHint
                ? "opacity-100"
                : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
            }`}
          >
            + 用时
          </button>
        )}
        {askTime && (
          <DurationInput
            initial={duration}
            onDone={(minutes) => {
              setAskTime(false);
              if (minutes !== undefined) updateTask(engine, task.id, { duration: minutes });
            }}
          />
        )}
      </div>
      <button
        type="button"
        aria-label="更多"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => actions.openMenu(task)}
        className="text-muted hover:text-text flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus:opacity-100"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
    </li>
  );
}

/** The empty line at the bottom: typing there adds a task. */
export function NewTaskRow({
  focusRequest,
  lastId,
  onAdd,
  onFocusLast,
  indentHint,
}: {
  focusRequest: FocusRequest | null;
  lastId: string | null;
  onAdd: (text: string, indent: number) => void;
  onFocusLast: () => void;
  indentHint: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [indent, setIndent] = useState<number | null>(null);
  const level = indent ?? indentHint;
  useFocusRequest(ref, "new", focusRequest);

  const add = (value: string) => {
    if (value.trim() === "") return;
    onAdd(value, level);
    setDraft("");
    setIndent(level);
  };

  return (
    <li
      className="flex items-start gap-3 py-[5px] pr-1"
      style={{ paddingLeft: level * INDENT_PX }}
      onClick={() => ref.current?.focus()}
    >
      <span className="flex h-6 w-5 shrink-0 items-center justify-center opacity-40">
        <TaskMark done={false} />
      </span>
      <span className="line-edit block min-w-0 flex-1 text-[15px] leading-6">
        <span aria-hidden="true">
          {draft}
          {"​"}
        </span>
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          aria-label="新任务"
          spellCheck={false}
          placeholder="两个空格缩进，退格回退"
          onBlur={() => add(draft)}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw.includes("\n")) {
              add(raw.replace(/\n/g, ""));
              return;
            }
            const { levels, text } = takeIndent(raw);
            if (levels > 0) setIndent(clampIndent(level + levels));
            setDraft(text);
          }}
          onKeyDown={(event) =>
            handleKeys(event, {
              value: draft,
              indent: level,
              setIndent,
              onEnter: (before, rest) => {
                if (draft.trim() === "" && level > 0) setIndent(level - 1);
                else add(before + rest);
              },
              onBackspaceEmpty: () => lastId && onFocusLast(),
              onUp: () => lastId && onFocusLast(),
              onDown: () => {},
            })
          }
        />
      </span>
    </li>
  );
}
