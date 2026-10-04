import { CalendarDays, ChevronLeft, ChevronRight, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar } from "../components/Calendar";
import { Sheet } from "../components/Sheet";
import { TaskMenu } from "../components/TaskMenu";
import { NewTaskRow, TaskRow, type FocusRequest, type LineActions } from "../components/TaskRow";
import { TaskWords } from "../components/TaskText";
import { useApp } from "../context";
import { readLocal, writeLocal } from "../hooks";
import {
  addTask,
  deleteTask,
  isWritten,
  leftFromYesterday,
  moveTasksToDay,
  tasksOfDay,
  totalMinutes,
  writtenTasks,
  type Task,
} from "../lib/model";
import { addDays, formatDuration, formatMonthDay, formatWeekday, relativeDay } from "../lib/time";
import { navigate } from "../router";
import { useTagColors } from "../useTagColors";

const dismissedKey = (today: string) => `moli-todo:carry-dismissed:${today}`;

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
                <label className="hover:bg-surface-2 flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-[15px] leading-6">
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
  const { engine, today, now, tick } = useApp();
  const tagColors = useTagColors();
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [calendar, setCalendar] = useState(false);
  const [justTicked, setJustTicked] = useState<string | null>(null);
  const [dismissedOn, setDismissedOn] = useState<string | null>(null);
  const dismissed = dismissedOn === today || readLocal(dismissedKey(today)) === "1";

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

  // Blank lines left behind (an Enter at the start of a line) go when the page does.
  useEffect(
    () => () => {
      for (const task of tasksOfDay(engine, day)) if (!isWritten(task)) deleteTask(engine, task.id);
    },
    [engine, day]
  );

  const focusLine = useCallback(
    (id: string, caret: number | "end") => setFocus((f) => ({ id, caret, seq: (f?.seq ?? 0) + 1 })),
    []
  );

  const actions: LineActions = {
    focus: focusLine,
    split: (task, before, rest) => {
      const index = tasks.findIndex((t) => t.id === task.id);
      const prev = tasks[index - 1];
      if (before === "" && rest === "") return;
      if (before === "") {
        addTask(engine, day, { after: prev?.id ?? null, indent: task.data.indent });
        focusLine(task.id, 0);
      } else if (rest === "" && index === tasks.length - 1) {
        focusLine("new", 0);
      } else {
        const id = addTask(engine, day, { text: rest, indent: task.data.indent, after: task.id });
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
  };

  const minutes = totalMinutes(tasks);
  const menuTask = menuFor ? engine.get("task", menuFor) : null;
  const last = tasks.at(-1) ?? null;
  const dismiss = () => {
    writeLocal(dismissedKey(today), "1");
    setDismissedOn(today);
  };

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-6rem)] max-w-2xl flex-col px-5 lg:min-h-[calc(100dvh-2rem)] lg:px-10">
      <DayHeader day={day} onCalendar={() => setCalendar(true)} />
      {left.length > 0 && !dismissed && <CarryOver key={today} left={left} onDone={dismiss} />}

      <ul className="flex-1 pt-3 pb-6" aria-label="任务">
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
          />
        ))}
        <NewTaskRow
          key={day}
          focusRequest={focus}
          lastId={last?.id ?? null}
          indentHint={last?.data.indent ?? 0}
          onAdd={(text, indent) => addTask(engine, day, { text, indent })}
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

      {menuTask && <TaskMenu task={menuTask} onClose={() => setMenuFor(null)} />}
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
