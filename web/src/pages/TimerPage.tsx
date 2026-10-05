import { BarChart3, CircleDashed, Pause, Play, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Sheet } from "../components/Sheet";
import { useApp } from "../context";
import { useNow } from "../hooks";
import {
  elapsed,
  finishTimer,
  getTimer,
  isRunning,
  isStarted,
  MIN_SESSION_SECONDS,
  pauseTimer,
  sessions,
  setTimerName,
  startTimer,
} from "../lib/focus";
import { isTodo, isWritten, tasksOfDay } from "../lib/model";
import { formatLong, formatStopwatch } from "../lib/time";
import { navigate } from "../router";

/** Task text without its tags, as a name for a run. */
const nameOf = (text: string) => text.replace(/#\S+/gu, "").trim() || text.trim();

function NamePicker({ onClose }: { onClose: () => void }) {
  const { engine, today } = useApp();
  const timer = getTimer(engine);
  const [draft, setDraft] = useState(timer.name);
  const todays = tasksOfDay(engine, today).filter((task) => isWritten(task) && isTodo(task));
  const choose = (name: string) => {
    setTimerName(engine, name);
    onClose();
  };
  return (
    <Sheet title="专注什么" onClose={onClose}>
      <form
        className="mb-5 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          choose(draft);
        }}
      >
        <input
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          placeholder="写个名字，比如 单词"
          aria-label="专注任务名"
          className="bg-surface-2 focus:ring-accent min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1"
        />
        <button type="submit" className="bg-accent text-accent-fg rounded-lg px-4 text-sm">
          好
        </button>
      </form>
      {todays.length > 0 && (
        <section>
          <h3 className="text-muted mb-1.5 text-xs">今天的任务</h3>
          <ul>
            {todays.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => choose(nameOf(task.data.text))}
                  className={`hover:bg-surface-2 w-full rounded-lg px-2 py-2 text-left text-[length:var(--list-size)] leading-[var(--list-leading)] ${
                    task.data.done ? "text-muted" : ""
                  }`}
                  style={{ paddingLeft: 8 + task.data.indent * 16 }}
                >
                  {nameOf(task.data.text)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Sheet>
  );
}

const RING = 120;
const STROKE = 9;

export function TimerPage({ clock }: { clock: () => number }) {
  const { engine, today, tick } = useApp();
  const timer = getTimer(engine);
  const running = isRunning(timer);
  const now = useNow(clock, running ? 250 : 5000);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const seconds = Math.floor(elapsed(timer, now));
  const todaySeconds = useMemo(
    () =>
      sessions(engine)
        .filter((s) => s.data.day === today)
        .reduce((sum, s) => sum + s.data.seconds, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, today, tick]
  );

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const finish = () => {
    const kept = finishTimer(engine, clock());
    setNotice(
      kept > 0 ? `记下了 ${formatLong(kept)}` : `不到 ${MIN_SESSION_SECONDS / 60} 分钟，这次没记`
    );
  };

  const circumference = 2 * Math.PI * RING;
  const turn = (seconds % 3600) / 3600;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-6rem)] max-w-xl flex-col px-5 lg:min-h-dvh">
      <header className="flex items-center justify-between pt-5 pb-3">
        <h1 className="text-2xl font-medium">计时</h1>
        <button
          type="button"
          onClick={() => navigate({ name: "stats" })}
          className="text-muted hover:text-text flex items-center gap-1.5 rounded-full px-3 py-2 text-sm"
        >
          <BarChart3 size={19} strokeWidth={1.75} aria-hidden="true" /> 统计
        </button>
      </header>

      <button
        type="button"
        onClick={() => setPicking(true)}
        className="bg-surface-2 hover:bg-border/60 flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors"
      >
        <CircleDashed
          size={22}
          className="text-accent-ink shrink-0"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium">
            {timer.name || "选一个专注任务"}
          </span>
          <span className="text-muted block text-xs">点此可更换专注任务</span>
        </span>
      </button>

      <div className="flex flex-1 flex-col items-center justify-center py-8">
        <div
          className="relative"
          style={{ width: 2 * RING + 2 * STROKE, height: 2 * RING + 2 * STROKE }}
        >
          <svg
            width={2 * RING + 2 * STROKE}
            height={2 * RING + 2 * STROKE}
            className="-rotate-90"
            aria-hidden="true"
          >
            <circle
              cx={RING + STROKE}
              cy={RING + STROKE}
              r={RING}
              fill="none"
              stroke="var(--moli-surface2)"
              strokeWidth={STROKE}
            />
            {isStarted(timer) && (
              <circle
                cx={RING + STROKE}
                cy={RING + STROKE}
                r={RING}
                fill="none"
                stroke="var(--moli-accent)"
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={`${circumference * Math.max(turn, 0.002)} ${circumference}`}
                className={running ? "" : "opacity-50"}
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className="font-serif text-[56px] leading-none font-semibold tabular-nums"
              role="timer"
              aria-label="已计时"
            >
              {formatStopwatch(seconds)}
            </span>
            <span className="text-muted mt-2 h-4 text-xs">
              {isStarted(timer) && !running ? "已暂停" : running ? "专注中" : ""}
            </span>
          </div>
        </div>

        <div className="mt-10 flex items-center gap-6">
          {isStarted(timer) && (
            <button
              type="button"
              onClick={finish}
              aria-label="结束"
              className="border-border text-muted hover:text-text flex h-14 w-14 items-center justify-center rounded-full border-2"
            >
              <Square size={18} fill="currentColor" aria-hidden="true" />
            </button>
          )}
          {running ? (
            <button
              type="button"
              onClick={() => pauseTimer(engine, clock())}
              aria-label="暂停"
              className="border-accent text-accent-ink flex h-[72px] w-[72px] items-center justify-center rounded-full border-[3px]"
            >
              <Pause size={28} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => startTimer(engine, clock())}
              aria-label={isStarted(timer) ? "继续" : "开始"}
              className="bg-accent text-accent-fg flex h-[72px] w-[72px] items-center justify-center rounded-full shadow-lg"
            >
              <Play size={28} fill="currentColor" className="ml-1" aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="text-muted mt-8 text-xs">今天已专注 {formatLong(todaySeconds)}</p>
      </div>

      {notice && (
        <div
          role="status"
          className="fade-in bg-text text-surface fixed inset-x-0 bottom-24 mx-auto w-max max-w-[90vw] rounded-full px-4 py-2 text-sm shadow-lg lg:bottom-10"
        >
          {notice}
        </div>
      )}
      {picking && <NamePicker onClose={() => setPicking(false)} />}
    </div>
  );
}
