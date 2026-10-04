// What the screens do with the records: the day lists, tags and appearance. Everything goes through the sync
// engine, so every change shows at once and is sent in the background.

import { MAX_INDENT, type Highlight, type SettingsData, type TaskData } from "@shared/records";
import { parseTags, renameTag, tagKey } from "@shared/tags";
import { positionAfter, positionBetween } from "./position";
import type { SyncEngine, View } from "./sync";
import { addDays } from "./time";

export type Task = View<"task">;

export const newId = (): string => crypto.randomUUID();

const byPosition = (a: Task, b: Task) =>
  a.data.position < b.data.position
    ? -1
    : a.data.position > b.data.position
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;

/** True for a line with something written on it (an empty line is only a place to type). */
export const isWritten = (task: Task): boolean => task.data.text.trim().length > 0;

export function tasksOfDay(engine: SyncEngine, day: string): Task[] {
  return engine
    .all("task")
    .filter((task) => task.data.day === day)
    .sort(byPosition);
}

/** Every written task, by day then list order. */
export function writtenTasks(engine: SyncEngine): Task[] {
  return engine
    .all("task")
    .filter(isWritten)
    .sort((a, b) =>
      a.data.day < b.data.day ? -1 : a.data.day > b.data.day ? 1 : byPosition(a, b)
    );
}

/** Minutes written down for a day's tasks. */
export const totalMinutes = (tasks: Task[]): number =>
  tasks.reduce((sum, task) => sum + (task.data.duration ?? 0), 0);

export interface NewTask {
  text?: string;
  indent?: number;
  /** Put it right after this task; null puts it first; at the end of the day when missing. */
  after?: string | null;
}

export function addTask(engine: SyncEngine, day: string, options: NewTask = {}): string {
  const list = tasksOfDay(engine, day);
  const index = options.after ? list.findIndex((task) => task.id === options.after) : -1;
  const position =
    options.after === null
      ? positionBetween(null, list[0]?.data.position ?? null)
      : index >= 0
        ? positionBetween(
            list[index]?.data.position ?? null,
            list[index + 1]?.data.position ?? null
          )
        : positionAfter(list.at(-1)?.data.position ?? null);
  const id = newId();
  engine.put("task", id, {
    day,
    text: options.text ?? "",
    indent: clampIndent(options.indent ?? 0),
    done: false,
    doneAt: null,
    duration: null,
    highlight: null,
    position,
  });
  return id;
}

export const clampIndent = (indent: number): number => Math.min(Math.max(indent, 0), MAX_INDENT);

export function updateTask(engine: SyncEngine, id: string, patch: Partial<TaskData>): void {
  const current = engine.get("task", id);
  if (!current) return;
  const next = { ...current.data, ...patch };
  next.indent = clampIndent(next.indent);
  if (JSON.stringify(next) === JSON.stringify(current.data)) return;
  engine.put("task", id, next);
}

export function toggleTask(engine: SyncEngine, id: string, now: number): boolean {
  const current = engine.get("task", id);
  if (!current) return false;
  const done = !current.data.done;
  updateTask(engine, id, { done, doneAt: done ? now : null });
  return done;
}

export const setHighlight = (engine: SyncEngine, id: string, highlight: Highlight | null) =>
  updateTask(engine, id, { highlight });

export const deleteTask = (engine: SyncEngine, id: string) => engine.remove("task", id);

/** Moves one task to sit before `beforeId` (or at the end) within its day. */
export function moveTask(engine: SyncEngine, id: string, beforeId: string | null): void {
  const task = engine.get("task", id);
  if (!task) return;
  const others = tasksOfDay(engine, task.data.day).filter((t) => t.id !== id);
  const index = beforeId === null ? others.length : others.findIndex((t) => t.id === beforeId);
  if (index < 0) return;
  updateTask(engine, id, {
    position: positionBetween(
      others[index - 1]?.data.position ?? null,
      others[index]?.data.position ?? null
    ),
  });
}

/** Moves tasks to the end of another day's list, keeping their order. */
export function moveTasksToDay(engine: SyncEngine, ids: string[], day: string): void {
  let last = tasksOfDay(engine, day).at(-1)?.data.position ?? null;
  for (const id of ids) {
    const task = engine.get("task", id);
    if (!task || task.data.day === day) continue;
    last = positionAfter(last);
    updateTask(engine, id, { day, position: last });
  }
}

/** Yesterday's written tasks that were not finished: the ones offered to move to today. */
export const leftFromYesterday = (engine: SyncEngine, today: string): Task[] =>
  tasksOfDay(engine, addDays(today, -1)).filter((task) => isWritten(task) && !task.data.done);

// Tags -------------------------------------------------------------------------------------------------------

export interface TagSummary {
  key: string;
  /** As first written. */
  name: string;
  color: string | null;
  count: number;
  done: number;
  minutes: number;
}

/**
 * The tags each written task counts under: its own, plus those of the line it is indented under (so "复盘"
 * indented below "R 21-1-3#阅读" counts as 阅读).
 */
export function tagsByTask(engine: SyncEngine): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let day = "";
  let stack: { indent: number; tags: string[] }[] = [];
  for (const task of writtenTasks(engine)) {
    if (task.data.day !== day) {
      day = task.data.day;
      stack = [];
    }
    while (stack.length > 0 && (stack.at(-1)?.indent ?? 0) >= task.data.indent) stack.pop();
    const tags: string[] = [];
    const seen = new Set<string>();
    for (const name of [...parseTags(task.data.text), ...(stack.at(-1)?.tags ?? [])]) {
      if (seen.has(tagKey(name))) continue;
      seen.add(tagKey(name));
      tags.push(name);
    }
    stack.push({ indent: task.data.indent, tags });
    result.set(task.id, tags);
  }
  return result;
}

/** Every tag in use, most used first. */
export function tagSummaries(engine: SyncEngine): TagSummary[] {
  const tags = new Map<string, TagSummary>();
  const byTask = tagsByTask(engine);
  for (const task of writtenTasks(engine)) {
    for (const name of byTask.get(task.id) ?? []) {
      const key = tagKey(name);
      const summary = tags.get(key) ?? {
        key,
        name,
        color: engine.get("tag", key)?.data.color ?? null,
        count: 0,
        done: 0,
        minutes: 0,
      };
      summary.count += 1;
      if (task.data.done) summary.done += 1;
      summary.minutes += task.data.duration ?? 0;
      tags.set(key, summary);
    }
  }
  return [...tags.values()].sort(
    (a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
}

/** Tasks counted under a tag (see `tagsByTask`), by day then list order. */
export function tasksWithTag(engine: SyncEngine, name: string): Task[] {
  const byTask = tagsByTask(engine);
  return writtenTasks(engine).filter((task) =>
    (byTask.get(task.id) ?? []).some((tag) => tagKey(tag) === tagKey(name))
  );
}

export const tagColor = (engine: SyncEngine, name: string): string | null =>
  engine.get("tag", tagKey(name))?.data.color ?? null;

export function setTagColor(engine: SyncEngine, name: string, color: string | null): void {
  engine.put("tag", tagKey(name), { name, color });
}

/** Writes `#to` wherever `#from` was, and carries the colour over. */
export function renameTagEverywhere(engine: SyncEngine, from: string, to: string): void {
  for (const task of writtenTasks(engine)) {
    const text = renameTag(task.data.text, from, to);
    if (text !== task.data.text) updateTask(engine, task.id, { text });
  }
  const color = tagColor(engine, from);
  if (tagKey(from) !== tagKey(to)) engine.remove("tag", tagKey(from));
  if (color) setTagColor(engine, to, color);
}

/** Tasks whose text contains every word of the query (case ignored), newest day first. */
export function searchTasks(engine: SyncEngine, query: string): Task[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return writtenTasks(engine)
    .filter((task) => {
      const text = task.data.text.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .reverse();
}

/** Tasks grouped by day, in the order given. */
export function groupByDay(tasks: Task[]): { day: string; tasks: Task[] }[] {
  const groups: { day: string; tasks: Task[] }[] = [];
  for (const task of tasks) {
    const last = groups.at(-1);
    if (last && last.day === task.data.day) last.tasks.push(task);
    else groups.push({ day: task.data.day, tasks: [task] });
  }
  return groups;
}

// Appearance -------------------------------------------------------------------------------------------------

export const SETTINGS_ID = "settings";
export const COVER_ID = "cover";
export const DEFAULT_SETTINGS: SettingsData = { accent: null, theme: "system", cover: "monet" };

export const getSettings = (engine: SyncEngine): SettingsData => ({
  ...DEFAULT_SETTINGS,
  ...engine.get("settings", SETTINGS_ID)?.data,
});

export function saveSettings(engine: SyncEngine, patch: Partial<SettingsData>): void {
  engine.put("settings", SETTINGS_ID, { ...getSettings(engine), ...patch });
}

export const uploadedCover = (engine: SyncEngine): string | null =>
  engine.get("cover", COVER_ID)?.data.image ?? null;

export function saveUploadedCover(engine: SyncEngine, image: string): void {
  engine.put("cover", COVER_ID, { image });
  saveSettings(engine, { cover: "upload" });
}
