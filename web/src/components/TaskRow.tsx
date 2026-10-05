import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { Mark } from "@shared/records";
import { useApp } from "../context";
import { fileUrl } from "../lib/images";
import {
  clampIndent,
  deleteTask,
  imagesOf,
  isTodo,
  markOf,
  toggleTask,
  updateTask,
  type Task,
} from "../lib/model";
import { formatDuration, parseDuration } from "../lib/time";
import { TaskMark, TaskWords, type TagColors } from "./TaskText";

export const INDENT_PX = 24;
const SAVE_DELAY_MS = 700;
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
  /** A line (a task id, or "new") started or stopped being edited. */
  editing: (id: string, on: boolean) => void;
  /** The text and caret of the line being edited, whenever either changes. */
  caret: (id: string, value: string, caret: number) => void;
  /** Lets the toolbar change the text of a line while it is being edited. */
  register: (id: string, editor: LineEditor | null) => void;
  openImage: (task: Task, file: string) => void;
}

/** What the toolbar can do to the text of the line being edited. */
export interface LineEditor {
  /** Writes `text` in place of `start`..`end` and puts the caret after it. */
  replace: (start: number, end: number, text: string) => void;
  /** The text as typed so far and where the caret is. */
  selection: () => { value: string; start: number; end: number };
  /** The new line only: keeps what is typed there as a task (returns its id, or null when empty). */
  commit?: () => string | null;
}

/** How the row is drawn while a line is being dragged. */
export interface RowDrag {
  /** This row is the one picked up. */
  lifted: boolean;
  /** How far the row is moved: the dragged one follows the finger, others slide aside. */
  offset: number;
  /** Some row is being dragged (others then animate). */
  active: boolean;
}

/** Pointer handlers from `useReorder` for one row. */
export type RowHandlers = Partial<
  Pick<
    React.HTMLAttributes<HTMLLIElement>,
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onClickCapture"
  >
>;

/** The place in a text a point on the screen falls on, read off the copy of the text drawn under the textarea. */
export function caretFromPoint(container: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  // Firefox and newer Chrome have the first, Safari the second.
  const position = doc.caretPositionFromPoint
    ? doc.caretPositionFromPoint(x, y)
    : doc.caretRangeFromPoint?.(x, y);
  if (!position) return null;
  const [node, offset] =
    "offsetNode" in position
      ? [position.offsetNode, position.offset]
      : [position.startContainer, position.startOffset];
  let total = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (text === node) return total + offset;
    total += (text as Text).length;
  }
  return null;
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

/** Puts the caret at `caret` once React has drawn the new text. */
function placeCaret(ref: React.RefObject<HTMLTextAreaElement | null>, caret: number) {
  requestAnimationFrame(() => ref.current?.setSelectionRange(caret, caret));
}

const dragStyle = (indent: number, drag: RowDrag | undefined): CSSProperties => ({
  paddingLeft: indent * INDENT_PX,
  ...(drag?.active
    ? {
        transform: drag.offset ? `translateY(${drag.offset}px)` : undefined,
        transition: drag.lifted ? "none" : "transform 160ms ease",
      }
    : {}),
});

export function TaskRow({
  task,
  tagColors,
  focusRequest,
  actions,
  prevId,
  nextId,
  showTimeHint,
  now,
  drag,
  handlers,
  uploading = 0,
}: {
  task: Task;
  tagColors: TagColors;
  focusRequest: FocusRequest | null;
  actions: LineActions;
  prevId: string | null;
  nextId: string;
  showTimeHint: boolean;
  now: number;
  drag?: RowDrag;
  handlers?: RowHandlers;
  /** Pictures on their way to the server for this line. */
  uploading?: number;
}) {
  const { engine } = useApp();
  const ref = useRef<HTMLTextAreaElement>(null);
  const copy = useRef<HTMLSpanElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.data.text);
  const [askTime, setAskTime] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useRef(false);
  const text = editing ? draft : task.data.text;
  const { done, indent, highlight, highlightStyle, duration } = task.data;
  const todo = isTodo(task);
  const images = imagesOf(task);

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
    const at = Math.max(0, caret - (raw.length - value.length));
    if (levels > 0) {
      setIndent(clampIndent(indent + levels));
      placeCaret(ref, at);
    }
    setDraft(value);
    actions.caret(task.id, value, at);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(value), SAVE_DELAY_MS);
  };

  // The toolbar edits through this; `latest` keeps it reading this render's text.
  const latest = useRef({ text, onChange });
  useEffect(() => {
    latest.current = { text, onChange };
  });
  useEffect(() => {
    actions.register(task.id, {
      replace: (start, end, insert) => {
        const value = latest.current.text;
        latest.current.onChange(
          value.slice(0, start) + insert + value.slice(end),
          start + insert.length
        );
        placeCaret(ref, start + insert.length);
      },
      selection: () => ({
        value: latest.current.text,
        start: ref.current?.selectionStart ?? latest.current.text.length,
        end: ref.current?.selectionEnd ?? latest.current.text.length,
      }),
    });
    return () => actions.register(task.id, null);
    // Registered once per line; the handle reads `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const tick = () => {
    const nowDone = toggleTask(engine, task.id, now);
    actions.ticked(task, nowDone);
  };

  /** A tap on the words of a line not being edited: edit it, with the caret where the finger was. */
  const editAt = (event: React.MouseEvent) => {
    const area = ref.current;
    if (!area || editing) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input")) return;
    const at = copy.current ? caretFromPoint(copy.current, event.clientX, event.clientY) : null;
    area.focus();
    const caret = Math.min(at ?? area.value.length, area.value.length);
    area.setSelectionRange(caret, caret);
  };

  return (
    <li
      data-task-id={task.id}
      className={`group relative flex items-start gap-3 py-[5px] pr-1 ${
        editing ? "" : "no-callout select-none"
      } ${drag?.lifted ? "bg-surface z-20 rounded-lg shadow-lg ring-1 ring-black/5" : ""}`}
      style={dragStyle(indent, drag)}
      {...handlers}
      onPointerDown={(event) => {
        touch.current = event.pointerType === "touch";
        handlers?.onPointerDown?.(event);
      }}
      onClick={editAt}
      onContextMenu={(event) => {
        // A long press on a phone is a drag, not a menu.
        if (touch.current) return event.preventDefault();
        if (event.target === ref.current && editing) return;
        event.preventDefault();
        actions.openMenu(task);
      }}
    >
      {todo ? (
        <button
          type="button"
          aria-label={done ? "标为未完成" : "标为完成"}
          aria-pressed={done}
          className="flex h-[var(--list-leading)] w-5 shrink-0 touch-manipulation items-center justify-center select-none"
          onClick={tick}
        >
          <TaskMark done={done} />
        </button>
      ) : (
        <span
          className="flex h-[var(--list-leading)] w-5 shrink-0 items-center justify-center"
          aria-label={markOf(task) === "dot" ? "圆点" : "横线"}
          role="img"
        >
          <TaskMark done={false} mark={markOf(task)} />
        </span>
      )}
      <div
        className={`min-w-0 flex-1 text-[length:var(--list-size)] leading-[var(--list-leading)] ${done ? "text-muted" : ""}`}
      >
        <span className="line-edit max-w-full min-w-[2em] align-top">
          <span aria-hidden="true" ref={copy}>
            <TaskWords
              text={text}
              highlight={highlight}
              highlightStyle={highlightStyle}
              tagColors={tagColors}
              muted={done}
            />
            {"\u200b"}
          </span>
          <textarea
            ref={ref}
            rows={1}
            value={text}
            aria-label="任务"
            spellCheck={false}
            className={`${done ? "caret-[var(--moli-muted)]" : ""} ${editing ? "" : "pointer-events-none"}`}
            onFocus={() => {
              setDraft(task.data.text);
              setEditing(true);
              actions.editing(task.id, true);
            }}
            onBlur={() => {
              setEditing(false);
              actions.editing(task.id, false);
              if (draft.trim() === "" && images.length === 0) deleteTask(engine, task.id);
              else if (draft !== task.data.text) save(draft);
            }}
            onSelect={(event) =>
              actions.caret(task.id, event.currentTarget.value, event.currentTarget.selectionStart)
            }
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
        {todo && done && duration !== null && !askTime && (
          <button
            type="button"
            onClick={() => setAskTime(true)}
            className="text-muted ml-2 align-top font-serif text-[0.92em] whitespace-nowrap"
            aria-label={`用时 ${formatDuration(duration)}，点击修改`}
          >
            {formatDuration(duration)}
          </button>
        )}
        {todo && done && duration === null && !askTime && (
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
        {(images.length > 0 || uploading > 0) && (
          <div className="mt-1.5 mb-1 flex flex-wrap gap-1.5">
            {images.map((file, i) => (
              <button
                key={file}
                type="button"
                aria-label={`看第 ${i + 1} 张图片`}
                onClick={() => actions.openImage(task, file)}
                className="bg-surface-2 no-callout h-14 w-14 overflow-hidden rounded-lg"
              >
                <img
                  src={fileUrl(file)}
                  alt=""
                  draggable={false}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
            {Array.from({ length: uploading }, (_, i) => (
              <span
                key={`up${i}`}
                role="status"
                aria-label="图片上传中"
                className="bg-surface-2 h-14 w-14 animate-pulse rounded-lg"
              />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/** The empty line at the bottom: typing there adds a task. Its indent and mark live in the page (the toolbar sets them). */
export function NewTaskRow({
  focusRequest,
  lastId,
  onAdd,
  onFocusLast,
  indent,
  setIndent,
  mark,
  actions,
}: {
  focusRequest: FocusRequest | null;
  lastId: string | null;
  onAdd: (text: string, indent: number, mark: Mark) => string;
  onFocusLast: () => void;
  indent: number;
  setIndent: (indent: number) => void;
  mark: Mark;
  actions: Pick<LineActions, "editing" | "caret" | "register">;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  useFocusRequest(ref, "new", focusRequest);

  const add = (value: string): string | null => {
    if (value.trim() === "") return null;
    const id = onAdd(value, indent, mark);
    setDraft("");
    actions.caret("new", "", 0);
    return id;
  };

  const change = (raw: string, caret: number) => {
    if (raw.includes("\n")) {
      add(raw.replace(/\n/g, ""));
      return;
    }
    const { levels, text } = takeIndent(raw);
    if (levels > 0) setIndent(clampIndent(indent + levels));
    setDraft(text);
    actions.caret("new", text, Math.max(0, caret - (raw.length - text.length)));
  };

  const latest = useRef({ draft, change, add });
  useEffect(() => {
    latest.current = { draft, change, add };
  });
  useEffect(() => {
    actions.register("new", {
      replace: (start, end, insert) => {
        const value = latest.current.draft;
        latest.current.change(
          value.slice(0, start) + insert + value.slice(end),
          start + insert.length
        );
        placeCaret(ref, start + insert.length);
      },
      selection: () => ({
        value: latest.current.draft,
        start: ref.current?.selectionStart ?? latest.current.draft.length,
        end: ref.current?.selectionEnd ?? latest.current.draft.length,
      }),
      commit: () => latest.current.add(latest.current.draft),
    });
    return () => actions.register("new", null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <li
      className="flex items-start gap-3 py-[5px] pr-1"
      style={{ paddingLeft: indent * INDENT_PX }}
      onClick={() => ref.current?.focus()}
    >
      <span className="flex h-[var(--list-leading)] w-5 shrink-0 items-center justify-center opacity-40">
        <TaskMark done={false} mark={mark} />
      </span>
      <span className="line-edit block min-w-0 flex-1 text-[length:var(--list-size)] leading-[var(--list-leading)]">
        <span aria-hidden="true">
          {draft}
          {"\u200b"}
        </span>
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          aria-label="新任务"
          spellCheck={false}
          onFocus={() => actions.editing("new", true)}
          onBlur={() => {
            actions.editing("new", false);
            add(draft);
          }}
          onSelect={(event) =>
            actions.caret("new", event.currentTarget.value, event.currentTarget.selectionStart)
          }
          onChange={(event) => change(event.target.value, event.target.selectionStart)}
          onKeyDown={(event) =>
            handleKeys(event, {
              value: draft,
              indent,
              setIndent,
              onEnter: (before, rest) => {
                if (draft.trim() === "" && indent > 0) setIndent(indent - 1);
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
