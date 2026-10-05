import { CalendarDays, ChevronLeft, ChevronRight, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_IMAGES_PER_TASK, type Mark } from "@shared/records";
import { tagBeforeCaret, tagKey } from "@shared/tags";
import { Calendar } from "../components/Calendar";
import { ImageViewer } from "../components/ImageViewer";
import { LineToolbar, type ToolbarLine } from "../components/LineToolbar";
import { Sheet } from "../components/Sheet";
import { TaskMenu } from "../components/TaskMenu";
import {
  NewTaskRow,
  TaskRow,
  type FocusRequest,
  type LineActions,
  type LineEditor,
  type RowDrag,
} from "../components/TaskRow";
import { TaskWords } from "../components/TaskText";
import { useApp } from "../context";
import { readLocal, writeLocal } from "../hooks";
import { UploadError } from "../lib/images";
import {
  addImages,
  addTask,
  clampIndent,
  deleteTask,
  imagesOf,
  isWritten,
  leftFromYesterday,
  markOf,
  moveTask,
  moveTasksToDay,
  removeImage,
  setHighlight,
  setMark,
  tagSummaries,
  tasksOfDay,
  totalMinutes,
  updateTask,
  writtenTasks,
  type Task,
} from "../lib/model";
import { shiftOf, useReorder } from "../lib/reorder";
import { addDays, formatDuration, formatMonthDay, formatWeekday, relativeDay } from "../lib/time";
import { navigate } from "../router";
import { useTagColors } from "../useTagColors";

const dismissedKey = (today: string) => `moli-todo:carry-dismissed:${today}`;
const NOTICE_MS = 3500;

const uploadProblem = (error: unknown): string =>
  error instanceof UploadError && error.reason === "offline"
    ? "没联网，图片传不上去"
    : error instanceof UploadError && error.reason === "unsupported"
      ? "这张图片用不了，换一张试试"
      : "图片没传上去，再试一次";

function DayHeader({ day, onCalendar }: { day: string; onCalendar: () => void }) {
  const { today } = useApp();
  const relative = relativeDay(day, today);
  const go = (target: string) =>
    navigate({ name: "today", day: target === today ? null : target }, true);
  return (
    <header className="border-border flex items-end justify-between border-b pt-5 pb-3">
      <div>
        <div className="flex items-baseline gap-2">
          <h1 className="font-serif text-lg font-bold tracking-wide">{formatMonthDay(day)}</h1>
          {relative && <span className="text-accent-ink text-xs font-medium">{relative}</span>}
          {day.slice(0, 4) !== today.slice(0, 4) && (
            <span className="text-muted text-xs">{day.slice(0, 4)}年</span>
          )}
        </div>
        <p className="mt-0.5 text-[28px] leading-9 font-medium">{formatWeekday(day)}</p>
      </div>
      <div className="text-muted flex items-center gap-0.5 pb-1">
        {day !== today && (
          <button
            type="button"
            onClick={() => go(today)}
            className="text-accent-ink hover:bg-accent-soft mr-1 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs"
          >
            <Undo2 size={13} aria-hidden="true" /> 回到今天
          </button>
        )}
        <button
          type="button"
          aria-label="前一天"
          onClick={() => go(addDays(day, -1))}
          className="hover:text-text rounded-full p-2"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="后一天"
          onClick={() => go(addDays(day, 1))}
          className="hover:text-text rounded-full p-2"
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="日历"
          onClick={onCalendar}
          className="hover:text-text rounded-full p-2"
        >
          <CalendarDays size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

/** "昨天还有 N 条没做完": pick which come over to today. */
function CarryOver({ left, onDone }: { left: Task[]; onDone: () => void }) {
  const { engine, today } = useApp();
  const tagColors = useTagColors();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(left.map((t) => t.id)));
  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <>
      <div className="bg-accent-soft mt-3 flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm">
        <span className="flex-1">
          昨天还有 <b className="text-accent-ink">{left.length}</b> 条没做完
        </span>
        <button type="button" onClick={onDone} className="text-muted hover:text-text px-1 text-xs">
          不用了
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="bg-accent text-accent-fg rounded-full px-3 py-1 text-xs font-medium"
        >
          挑一挑
        </button>
      </div>
      {open && (
        <Sheet title="挪到今天" onClose={() => setOpen(false)}>
          <ul className="mb-4 space-y-1">
            {left.map((task) => (
              <li key={task.id}>
                <label className="hover:bg-surface-2 flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-[length:var(--list-size)] leading-[var(--list-leading)]">
                  <input
                    type="checkbox"
                    checked={picked.has(task.id)}
                    onChange={() => toggle(task.id)}
                    className="accent-[var(--moli-accent)] mt-1 h-4 w-4 shrink-0"
                  />
                  <span style={{ paddingLeft: task.data.indent * 16 }}>
                    <TaskWords
                      text={task.data.text}
                      highlight={task.data.highlight}
                      highlightStyle={task.data.highlightStyle}
                      tagColors={tagColors}
                    />
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDone}
              className="bg-surface-2 hover:bg-border flex-1 rounded-full py-2 text-sm"
            >
              不用了
            </button>
            <button
              type="button"
              disabled={picked.size === 0}
              onClick={() => {
                moveTasksToDay(
                  engine,
                  left.filter((t) => picked.has(t.id)).map((t) => t.id),
                  today
                );
                setOpen(false);
                if (picked.size === left.length) onDone();
              }}
              className="bg-accent text-accent-fg flex-1 rounded-full py-2 text-sm font-medium disabled:opacity-40"
            >
              挪 {picked.size} 条到今天
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

export function TodayPage({ day }: { day: string }) {
  const { engine, files, today, now, tick } = useApp();
  const tagColors = useTagColors();
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [calendar, setCalendar] = useState(false);
  const [justTicked, setJustTicked] = useState<string | null>(null);
  const [dismissedOn, setDismissedOn] = useState<string | null>(null);
  const dismissed = dismissedOn === today || readLocal(dismissedKey(today)) === "1";
  /** The line being edited (a task id, or "new"), which the toolbar works on. */
  const [active, setActive] = useState<string | null>(null);
  const [caret, setCaret] = useState<{ id: string; value: string; at: number } | null>(null);
  const editors = useRef(new Map<string, LineEditor>());
  /** The bottom line's indent and mark; null follows the last line. */
  const [newStyle, setNewStyle] = useState<{
    day: string;
    indent: number | null;
    mark: Mark | null;
  }>({ day, indent: null, mark: null });
  // Another day starts afresh.
  const style = newStyle.day === day ? newStyle : { day, indent: null, mark: null };
  const newIndent = style.indent;
  const newMark = style.mark;
  const restyle = (patch: { indent?: number; mark?: Mark }) => setNewStyle({ ...style, ...patch });
  const [viewing, setViewing] = useState<{ task: string; file: string } | null>(null);
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tasks = useMemo(() => tasksOfDay(engine, day), [engine, day, tick]);
  const left = useMemo(
    () => (day === today ? leftFromYesterday(engine, today) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, day, today, tick]
  );
  const writtenDays = useMemo(
    () => new Set(writtenTasks(engine).map((t) => t.data.day)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, tick, calendar]
  );
  const editingAny = active !== null;
  const tagNames = useMemo(
    () => (editingAny ? tagSummaries(engine).map((t) => t.name) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, tick, editingAny]
  );

  // Blank lines left behind (an Enter at the start of a line) go when the page does.
  useEffect(
    () => () => {
      for (const task of tasksOfDay(engine, day))
        if (!isWritten(task) && imagesOf(task).length === 0) deleteTask(engine, task.id);
    },
    [engine, day]
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const focusLine = useCallback(
    (id: string, caret: number | "end") => setFocus((f) => ({ id, caret, seq: (f?.seq ?? 0) + 1 })),
    []
  );

  const actions: LineActions = {
    focus: focusLine,
    split: (task, before, rest) => {
      const index = tasks.findIndex((t) => t.id === task.id);
      const prev = tasks[index - 1];
      const line = { indent: task.data.indent, mark: markOf(task) };
      if (before === "" && rest === "") return;
      if (before === "") {
        addTask(engine, day, { after: prev?.id ?? null, ...line });
        focusLine(task.id, 0);
      } else if (rest === "" && index === tasks.length - 1) {
        restyle(line);
        focusLine("new", 0);
      } else {
        const id = addTask(engine, day, { text: rest, after: task.id, ...line });
        focusLine(id, 0);
      }
    },
    removeEmpty: (task) => {
      const index = tasks.findIndex((t) => t.id === task.id);
      const prev = tasks[index - 1];
      const next = tasks[index + 1];
      deleteTask(engine, task.id);
      if (prev) focusLine(prev.id, "end");
      else focusLine(next?.id ?? "new", 0);
    },
    openMenu: (task) => setMenuFor(task.id),
    ticked: (task, done) => setJustTicked(done ? task.id : null),
    editing: (id, on) => setActive((current) => (on ? id : current === id ? null : current)),
    caret: (id, value, at) => setCaret({ id, value, at }),
    register: (id, editor) => {
      if (editor) editors.current.set(id, editor);
      else editors.current.delete(id);
    },
    openImage: (task, file) => setViewing({ task: task.id, file }),
  };

  const { drag, handlers } = useReorder({
    ids: tasks.map((t) => t.id),
    rows: () => [
      ...(list.current as HTMLUListElement).querySelectorAll<HTMLElement>("li[data-task-id]"),
    ],
    onMove: (id, before) => moveTask(engine, id, before),
  });
  const rowDrag = (index: number): RowDrag | undefined =>
    drag
      ? {
          active: true,
          lifted: drag.from === index,
          offset: drag.from === index ? drag.dy : shiftOf(index, drag.from, drag.to, drag.height),
        }
      : undefined;

  const minutes = totalMinutes(tasks);
  const menuTask = menuFor ? engine.get("task", menuFor) : null;
  const last = tasks.at(-1) ?? null;
  const dismiss = () => {
    writeLocal(dismissedKey(today), "1");
    setDismissedOn(today);
  };

  // The toolbar -----------------------------------------------------------------------------------------------

  const newLevel = newIndent ?? last?.data.indent ?? 0;
  const newKind = newMark ?? (last ? markOf(last) : "box");
  const activeTask = active && active !== "new" ? engine.get("task", active) : null;
  const typed = caret && caret.id === active ? caret : null;
  const toolbarLine: ToolbarLine = activeTask
    ? {
        mark: markOf(activeTask),
        indent: activeTask.data.indent,
        highlight: activeTask.data.highlight,
        highlightStyle: activeTask.data.highlightStyle ?? "fill",
        written: true,
      }
    : {
        mark: newKind,
        indent: newLevel,
        highlight: null,
        highlightStyle: "fill",
        written: (typed?.value.trim() ?? "") !== "",
      };
  const typingTag = typed ? tagBeforeCaret(typed.value, typed.at) : null;
  const suggestions = typingTag
    ? tagNames
        .filter(
          (name) =>
            tagKey(name).startsWith(tagKey(typingTag.query)) &&
            tagKey(name) !== tagKey(typingTag.query)
        )
        .slice(0, 12)
    : [];

  /** The line being edited; the toolbar is only there while there is one, and every line registers itself. */
  const editor = () => editors.current.get(active as string) as LineEditor;
  /** The task the toolbar acts on; what is typed on the bottom line becomes a task first. */
  const target = (): string | null => {
    if (active !== "new") return active;
    // The tools that need a task are off until something is typed, so this makes one.
    const id = (editor().commit as () => string | null)();
    if (id) focusLine(id, "end");
    return id;
  };

  const upload = async (picked: File[]) => {
    const task = engine.get("task", uploadFor.current ?? "");
    if (!task) return;
    const id = task.id;
    const room = MAX_IMAGES_PER_TASK - imagesOf(task).length;
    if (picked.length > room) setNotice(`一行最多放 ${MAX_IMAGES_PER_TASK} 张图片`);
    const chosen = picked.slice(0, room);
    const count = (by: number) => setUploading((u) => ({ ...u, [id]: (u[id] ?? 0) + by }));
    count(chosen.length);
    for (const file of chosen) {
      try {
        addImages(engine, id, [await files.upload(file)]);
      } catch (error) {
        setNotice(uploadProblem(error));
      } finally {
        count(-1);
      }
    }
  };

  const viewingTask = viewing ? engine.get("task", viewing.task) : null;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-6rem)] max-w-2xl flex-col px-5 lg:min-h-[calc(100dvh-2rem)] lg:px-10">
      <DayHeader day={day} onCalendar={() => setCalendar(true)} />
      {left.length > 0 && !dismissed && <CarryOver key={today} left={left} onDone={dismiss} />}

      <ul ref={list} className={`flex-1 pt-3 ${active ? "pb-32" : "pb-6"}`} aria-label="任务">
        {tasks.map((task, i) => (
          <TaskRow
            key={task.id}
            task={task}
            tagColors={tagColors}
            focusRequest={focus}
            actions={actions}
            prevId={tasks[i - 1]?.id ?? null}
            nextId={tasks[i + 1]?.id ?? "new"}
            showTimeHint={justTicked === task.id}
            now={now}
            drag={rowDrag(i)}
            handlers={handlers(task.id)}
            uploading={uploading[task.id] ?? 0}
          />
        ))}
        <NewTaskRow
          key={day}
          focusRequest={focus}
          lastId={last?.id ?? null}
          indent={newLevel}
          setIndent={(indent) => restyle({ indent: clampIndent(indent) })}
          mark={newKind}
          actions={actions}
          onAdd={(text, indent, mark) => {
            restyle({ indent, mark });
            return addTask(engine, day, { text, indent, mark });
          }}
          onFocusLast={() => last && focusLine(last.id, "end")}
        />
      </ul>

      <footer className="bg-surface/90 sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] -mx-5 flex justify-end px-5 py-2.5 backdrop-blur lg:bottom-0 lg:-mx-10 lg:px-10">
        <span className="text-muted text-sm">
          {day === today ? "今日" : "当日"}总计{" "}
          <span className="text-text ml-1 font-serif text-base">
            {minutes > 0 ? formatDuration(minutes) : "0min"}
          </span>
        </span>
      </footer>

      {active && (
        <LineToolbar
          line={toolbarLine}
          tags={suggestions}
          onMark={(mark) => (activeTask ? setMark(engine, activeTask.id, mark) : restyle({ mark }))}
          onIndent={(step) =>
            activeTask
              ? updateTask(engine, activeTask.id, { indent: activeTask.data.indent + step })
              : restyle({ indent: clampIndent(newLevel + step) })
          }
          onHash={() => {
            const { start, end } = editor().selection();
            editor().replace(start, end, "#");
          }}
          onTag={(name) => {
            // Tags are offered only while one is being typed at the caret.
            const tag = typingTag as { start: number };
            const { value, at } = typed as { value: string; at: number };
            const space = /\s/.test(value.charAt(at)) ? "" : " ";
            editor().replace(tag.start, at, `#${name}${space}`);
          }}
          onHighlight={(color, style) => {
            const id = target();
            if (id) setHighlight(engine, id, color, style);
          }}
          onImages={() => {
            uploadFor.current = target();
            fileInput.current?.click();
          }}
          onMore={() => {
            const id = target();
            if (id) setMenuFor(id);
          }}
        />
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        aria-label="添加图片"
        className="hidden"
        onChange={(event) => {
          void upload([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      {notice && (
        <p
          role="status"
          className="bg-text text-surface fixed inset-x-0 bottom-[calc(7.5rem+env(safe-area-inset-bottom))] z-50 mx-auto w-fit max-w-[90%] rounded-full px-4 py-2 text-sm shadow-lg lg:bottom-20"
        >
          {notice}
        </p>
      )}

      {menuTask && <TaskMenu task={menuTask} onClose={() => setMenuFor(null)} />}
      {viewing && viewingTask && (
        <ImageViewer
          files={imagesOf(viewingTask)}
          start={viewing.file}
          onClose={() => setViewing(null)}
          onDelete={(file) => {
            removeImage(engine, viewingTask.id, file);
            void files.remove(file);
          }}
        />
      )}
      {calendar && (
        <Sheet title="选一天" onClose={() => setCalendar(false)}>
          <Calendar
            selected={day}
            today={today}
            marked={writtenDays}
            onPick={(target) => {
              setCalendar(false);
              navigate({ name: "today", day: target === today ? null : target }, true);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
