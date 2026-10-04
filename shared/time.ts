// Dates and durations the way people see them. All days are Singapore days (standard 013): UTC+8, no daylight
// saving, so day arithmetic is plain offset arithmetic and gives the same answer on every device.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const OFFSET_MS = 8 * HOUR_MS;
const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const RELATIVE_DAYS = ["今天", "昨天", "前天"];

export const MAX_DURATION_MINUTES = 100 * 60;

/** Midnight (Singapore) at the start of the day that contains `timestamp`. */
export const startOfDay = (timestamp: number): number =>
  Math.floor((timestamp + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;

export const addDays = (dayStart: number, days: number): number => dayStart + days * DAY_MS;

/** Calendar parts of a moment, read in Singapore time. */
function parts(timestamp: number) {
  const date = new Date(timestamp + OFFSET_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    ms: date.getUTCMilliseconds(),
  };
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** "YYYY-MM-DD", the value format of a date input. */
export function toDateInputValue(timestamp: number): string {
  const p = parts(timestamp);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Midnight for a "YYYY-MM-DD" value, or null when it is not a real date. */
export function parseDateInputValue(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return utc.getTime() - OFFSET_MS;
}

/**
 * The completion time moved onto `dayStart`, keeping its time of day so the order within a day survives;
 * never later than `now`. A task with no completion time lands at noon.
 */
export function moveToDay(doneAt: number | null, dayStart: number, now: number): number {
  const timeOfDay = doneAt === null ? 12 * HOUR_MS : doneAt - startOfDay(doneAt);
  return Math.min(dayStart + timeOfDay, now);
}

export function formatClock(timestamp: number): string {
  const p = parts(timestamp);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "今天", "昨天", "前天", then "10月1日 星期三" (with the year when it is not this year). */
export function formatDayLabel(dayStart: number, now: number): string {
  const daysAgo = Math.round((startOfDay(now) - dayStart) / DAY_MS);
  const relative = RELATIVE_DAYS[daysAgo];
  if (daysAgo >= 0 && relative) return relative;
  const p = parts(dayStart);
  const prefix = p.year === parts(now).year ? "" : `${p.year}年`;
  return `${prefix}${p.month}月${p.day}日 ${WEEKDAYS[p.weekday]}`;
}

export interface CompletedTask {
  done: boolean;
  doneAt: number | null;
  duration: number;
}

export interface DayGroup<T extends CompletedTask> {
  /** The day's start as text, or "undated". */
  key: string;
  dayStart: number | null;
  tasks: T[];
  /** Minutes spent that day. */
  total: number;
}

export const UNDATED_KEY = "undated";

/** Completed tasks by day, newest day and newest task first; tasks with no completion time come last. */
export function groupCompletedByDay<T extends CompletedTask>(tasks: T[]): DayGroup<T>[] {
  const days = new Map<number, T[]>();
  const undated: T[] = [];
  for (const task of tasks) {
    if (!task.done) continue;
    if (task.doneAt === null) {
      undated.push(task);
      continue;
    }
    const dayStart = startOfDay(task.doneAt);
    days.set(dayStart, [...(days.get(dayStart) ?? []), task]);
  }
  const sum = (list: T[]) => list.reduce((total, task) => total + task.duration, 0);
  const groups: DayGroup<T>[] = [...days.entries()]
    .sort(([a], [b]) => b - a)
    .map(([dayStart, list]) => ({
      key: String(dayStart),
      dayStart,
      tasks: list.sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
      total: sum(list),
    }));
  if (undated.length > 0) {
    groups.push({ key: UNDATED_KEY, dayStart: null, tasks: undated, total: sum(undated) });
  }
  return groups;
}

function normalizeDurationText(input: string): string {
  return (
    input
      // Full-width digits, colon and period typed through a Chinese IME.
      .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/：/g, ":")
      .replace(/[．。]/g, ".")
      .replace(/\s+/g, "")
      .toLowerCase()
  );
}

/**
 * Minutes for "45", "45m", "45分钟", "1h30m", "1小时30分", "1:30" or "1.5h"; 0 for an empty input;
 * null when the input is not a duration or is longer than 100 hours.
 */
export function parseDuration(input: string): number | null {
  const text = normalizeDurationText(input);
  if (!text) return 0;

  let minutes: number | null = null;
  let match: RegExpExecArray | null;
  if ((match = /^(\d+):([0-5]?\d)$/.exec(text))) {
    minutes = Number(match[1]) * 60 + Number(match[2]);
  } else if (/^\d+$/.test(text)) {
    minutes = Number(text);
  } else if (
    (match = /^(?:(\d+(?:\.\d+)?)(?:h|hr|hrs|小时|时))?(?:(\d+)(?:m|min|mins|分钟|分)?)?$/.exec(
      text
    )) &&
    (match[1] !== undefined || match[2] !== undefined)
  ) {
    minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  }

  if (minutes === null || !Number.isFinite(minutes) || minutes > MAX_DURATION_MINUTES) return null;
  return Math.round(minutes);
}

export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}分钟`;
  if (rest === 0) return `${hours}小时`;
  return `${hours}小时${rest}分`;
}
