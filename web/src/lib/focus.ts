// The stopwatch and its statistics. The stopwatch is one record (`timer/current`) so a run keeps going after
// a reload or on another device; each finished run becomes a `session` record.

import { MAX_SESSION_SECONDS, type SessionData, type TimerData } from "@shared/records";
import { newId } from "./model";
import type { SyncEngine, View } from "./sync";
import { addDays, dayKey, dayParts, daysBetween, daysInMonth, keyOfDate } from "./time";

export const TIMER_ID = "current";
/** Runs shorter than this are not kept. */
export const MIN_SESSION_SECONDS = 60;
export const UNNAMED = "未命名";

export type Session = View<"session">;

const IDLE: TimerData = { name: "", startedAt: null, accumulated: 0, runningSince: null };

export const getTimer = (engine: SyncEngine): TimerData =>
  engine.get("timer", TIMER_ID)?.data ?? IDLE;

/** Seconds on the stopwatch at `now`. */
export function elapsed(timer: TimerData, now: number): number {
  const running = timer.runningSince === null ? 0 : Math.max(0, now - timer.runningSince) / 1000;
  return Math.min(timer.accumulated + running, MAX_SESSION_SECONDS);
}

export const isRunning = (timer: TimerData) => timer.runningSince !== null;
export const isStarted = (timer: TimerData) => timer.startedAt !== null;

export function setTimerName(engine: SyncEngine, name: string): void {
  engine.put("timer", TIMER_ID, { ...getTimer(engine), name: name.trim().slice(0, 200) });
}

export function startTimer(engine: SyncEngine, now: number): void {
  const timer = getTimer(engine);
  if (isRunning(timer)) return;
  engine.put("timer", TIMER_ID, {
    ...timer,
    startedAt: timer.startedAt ?? now,
    runningSince: now,
  });
}

export function pauseTimer(engine: SyncEngine, now: number): void {
  const timer = getTimer(engine);
  if (!isRunning(timer)) return;
  engine.put("timer", TIMER_ID, {
    ...timer,
    accumulated: Math.floor(elapsed(timer, now)),
    runningSince: null,
  });
}

/**
 * Ends the run: keeps it as a session when it is long enough, and resets the stopwatch (keeping the name).
 * Returns the seconds kept, or 0 when the run was too short.
 */
export function finishTimer(engine: SyncEngine, now: number): number {
  const timer = getTimer(engine);
  if (!isStarted(timer)) return 0;
  const seconds = Math.floor(elapsed(timer, now));
  engine.put("timer", TIMER_ID, { ...IDLE, name: timer.name });
  if (seconds < MIN_SESSION_SECONDS) return 0;
  const startedAt = timer.startedAt as number;
  engine.put("session", newId(), {
    name: timer.name.trim() || UNNAMED,
    startedAt,
    endedAt: now,
    seconds,
    day: dayKey(startedAt),
  });
  return seconds;
}

export const deleteSession = (engine: SyncEngine, id: string) => engine.remove("session", id);

/** Every session, newest first. */
export const sessions = (engine: SyncEngine): Session[] =>
  engine.all("session").sort((a, b) => b.data.startedAt - a.data.startedAt);

/** Names used before, most recent first, without repeats. */
export function recentNames(engine: SyncEngine, limit = 8): string[] {
  const names: string[] = [];
  for (const session of sessions(engine)) {
    if (!names.includes(session.data.name)) names.push(session.data.name);
    if (names.length >= limit) break;
  }
  return names;
}

// Statistics -------------------------------------------------------------------------------------------------

export interface Totals {
  seconds: number;
  /** Seconds per day, from the first session's day to today. */
  perDay: number;
}

export function totals(list: SessionData[], today: string): Totals {
  const seconds = list.reduce((sum, s) => sum + s.seconds, 0);
  if (list.length === 0) return { seconds: 0, perDay: 0 };
  const first = list.reduce((min, s) => (s.day < min ? s.day : min), today);
  const days = Math.max(1, daysBetween(first, today) + 1);
  return { seconds, perDay: seconds / days };
}

export interface Slice {
  name: string;
  seconds: number;
  /** 0 to 1. */
  share: number;
}

/** Time per name between two days (both included), largest first. */
export function distribution(list: SessionData[], from: string, to: string): Slice[] {
  const byName = new Map<string, number>();
  let total = 0;
  for (const session of list) {
    if (session.day < from || session.day > to) continue;
    byName.set(session.name, (byName.get(session.name) ?? 0) + session.seconds);
    total += session.seconds;
  }
  return [...byName.entries()]
    .map(([name, seconds]) => ({ name, seconds, share: total > 0 ? seconds / total : 0 }))
    .sort((a, b) => b.seconds - a.seconds || (a.name < b.name ? -1 : 1));
}

export interface Point {
  label: string;
  seconds: number;
}

/** Seconds on each day of a month. */
export function monthSeries(list: SessionData[], year: number, month: number): Point[] {
  const points: Point[] = [];
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    points.push({ label: `${month}-${day}`, seconds: 0 });
  }
  for (const session of list) {
    const p = dayParts(session.day);
    if (p.year === year && p.month === month)
      (points[p.day - 1] as Point).seconds += session.seconds;
  }
  return points;
}

/** Seconds in each month of a year. */
export function yearSeries(list: SessionData[], year: number): Point[] {
  const points = Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}月`, seconds: 0 }));
  for (const session of list) {
    const p = dayParts(session.day);
    if (p.year === year) (points[p.month - 1] as Point).seconds += session.seconds;
  }
  return points;
}

export type RangeKind = "day" | "week" | "month" | "custom";

/** The first and last day of the range of a kind that contains `anchor`. */
export function rangeOf(kind: Exclude<RangeKind, "custom">, anchor: string): [string, string] {
  if (kind === "day") return [anchor, anchor];
  if (kind === "week") {
    const weekday = dayParts(anchor).weekday;
    const monday = addDays(anchor, weekday === 0 ? -6 : 1 - weekday);
    return [monday, addDays(monday, 6)];
  }
  const p = dayParts(anchor);
  return [keyOfDate(p.year, p.month, 1), keyOfDate(p.year, p.month, daysInMonth(p.year, p.month))];
}

/** The anchor moved one range back (-1) or forward (1). */
export function shiftAnchor(
  kind: Exclude<RangeKind, "custom">,
  anchor: string,
  step: number
): string {
  if (kind === "day") return addDays(anchor, step);
  if (kind === "week") return addDays(anchor, 7 * step);
  const p = dayParts(anchor);
  const index = p.year * 12 + (p.month - 1) + step;
  return keyOfDate(Math.floor(index / 12), (index % 12) + 1, 1);
}
